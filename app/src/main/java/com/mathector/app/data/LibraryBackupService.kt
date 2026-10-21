package com.mathector.app.data

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

class ExportedLibraryBackup(val file: File, val summary: BackupSummary) : Closeable {
    override fun close() { file.delete() }
}

class PreparedLibraryBackup internal constructor(val file: File, internal val data: LibraryBackupData, val summary: BackupSummary) : Closeable {
    override fun close() { file.delete() }
}

/** A versioned ZIP of portable records and content-addressed originals, independent of a device's database paths. */
class LibraryBackupService(private val context: Context, private val database: MathectorDatabase,
    private val knowledge: CustomKnowledgeStore, private val sourceRoot: File = File(context.filesDir, "restored-sources")) {
    private fun temporary(prefix: String): File = File.createTempFile(prefix, ".zip", File(context.cacheDir, "library-backups").apply { mkdirs() })

    suspend fun exchangeInventory(): org.json.JSONObject = withContext(Dispatchers.IO) {
        val dao=database.dao()
        val all=database.withTransaction { Triple(dao.backupQuestions(),dao.backupCollections(),dao.backupItems()) }
        val points=knowledge.snapshot(); val qs=org.json.JSONObject(); val cs=org.json.JSONObject()
        // A local question outside desktop limits stays editable. Omitting its digest prevents a false skip.
        all.first.forEach { raw ->
            try {
                val q=NativeDesktopAdapter.question(context,raw)
                val source=File(q.sourcePath); val sources=if(q.sourcePath.isNotBlank() && source.isFile) mapOf(q.id to "sources/${DesktopPortable.sourceHash(source)}.img") else emptyMap()
                val data=LibraryBackupData(listOf(q),emptyList(),emptyList(),points,sources,if(q.solution.isNotBlank() && q.solutionFingerprint==q.contentFingerprint()) setOf(q.id) else emptySet(),0,desktopFormat=true)
                val one=ExchangeInventory.fromManifest(org.json.JSONObject(String(LibraryBackupCodec.encode(data),Charsets.UTF_8))).getJSONObject("questions")
                qs.put(q.id,one.getString(q.id))
            } catch(cancel: kotlinx.coroutines.CancellationException) { throw cancel } catch(_: IllegalArgumentException) { /* Unsupported native content must never be marked identical. */ }
        }
        all.second.forEach { raw ->
            val c=NativeDesktopAdapter.collection(raw,all.third)
            val data=LibraryBackupData(emptyList(),emptyList(),emptyList(),points,emptyMap(),emptySet(),0,desktopFormat=true)
            val manifest=org.json.JSONObject(String(LibraryBackupCodec.encode(data),Charsets.UTF_8))
            manifest.put("collections",org.json.JSONArray().put(org.json.JSONObject().put("id",c.id).put("title",c.title).put("createdAt",c.createdAt).put("paperTitle",c.paperTitle).put("examInstructions",c.examInstructions).put("examMinutes",c.examMinutes).put("totalScore",c.totalScore).put("questionLayout",org.json.JSONObject(c.questionLayoutJson))))
            manifest.put("items",org.json.JSONArray().apply { all.third.filter { it.collectionId==c.id }.forEach { put(org.json.JSONObject().put("collectionId",it.collectionId).put("questionId",it.questionId).put("position",it.position)) } })
            val one=ExchangeInventory.fromManifest(manifest).getJSONObject("collections"); cs.put(c.id,one.getString(c.id))
        }
        org.json.JSONObject().put("version",1).put("questions",qs).put("collections",cs)
    }

    suspend fun changedSelection(questionIds: Set<String>, collectionIds: Set<String>, remote: org.json.JSONObject): Pair<Set<String>,Set<String>> {
        ExchangeInventory.validate(remote); val local=exchangeInventory()
        val members=database.dao().backupItems().filter { it.collectionId in collectionIds }.map { it.questionId }
        val q=questionIds+members
        return q.filter { !local.getJSONObject("questions").has(it) || local.getJSONObject("questions").getString(it)!=remote.getJSONObject("questions").optString(it) }.toSet() to collectionIds.filter { !local.getJSONObject("collections").has(it) || local.getJSONObject("collections").getString(it)!=remote.getJSONObject("collections").optString(it) }.toSet()
    }

    suspend fun createArchive(questionIds: Set<String>? = null, collectionIds: Set<String>? = null, desktopFormat: Boolean = questionIds != null || collectionIds != null): ExportedLibraryBackup = withContext(Dispatchers.IO) {
        val dao = database.dao()
        val all = database.withTransaction { Triple(dao.backupQuestions(), dao.backupCollections(), dao.backupItems()) }
        val selectedCollections = collectionIds.orEmpty()
        val selectedQuestions = questionIds.orEmpty() + all.third.filter { it.collectionId in selectedCollections }.map { it.questionId }
        if(questionIds != null || collectionIds != null) require(selectedQuestions.all { id -> all.first.any { it.id == id } } && selectedCollections.all { id -> all.second.any { it.id == id } }) { "所选资料已变化，请重新选择" }
        val snapshot = if(questionIds == null && collectionIds == null) all else Triple(all.first.filter { it.id in selectedQuestions }, all.second.filter { it.id in selectedCollections }, all.third.filter { it.collectionId in selectedCollections })
        BackupPolicy.validateReferences(snapshot.first, snapshot.second, snapshot.third)
        val questions = if(desktopFormat) snapshot.first.map { NativeDesktopAdapter.question(context, it) } else snapshot.first
        val files = linkedMapOf<String, File>()
        val sources = mutableMapOf<String, String>()
        val figures = mutableMapOf<String, MutableList<String>>()
        val optionFigures = mutableMapOf<String, MutableMap<String, MutableList<String>>>()
        var missing = 0
        var missingFigures = 0
        var unpacked = 0L
        questions.forEach { q ->
            if(q.sourcePath.isNotBlank()) {
                val source = File(q.sourcePath)
                if(!source.isFile) missing++ else {
                    require(source.length() <= BackupPolicy.MAX_SOURCE_BYTES) { "有原图超过 50 MB，无法备份" }
                    val hash = source.inputStream().use { copyChecked(it, null, BackupPolicy.MAX_SOURCE_BYTES).second }
                    val extension = source.extension.lowercase().takeIf { it in setOf("jpg", "jpeg", "png", "webp", "heic", "heif") } ?: "img"
                    val entry = files.keys.firstOrNull { it.substringAfter('/').substringBefore('.') == hash } ?: "sources/$hash.$extension"
                    if(entry !in files) { files[entry] = source; unpacked += source.length() }
                    require(unpacked <= BackupPolicy.MAX_ARCHIVE_BYTES) { "题库原图总大小超过 512 MB，请分批整理后备份" }
                    sources[q.id] = entry
                }
            }
            fun archive(name: String): String? {
                val figure = QuestionFigures.file(context, name)
                if(!figure.isFile) { missingFigures++; return null }
                require(figure.length() <= BackupPolicy.MAX_SOURCE_BYTES) { "有题目图片超过 50 MB，无法备份" }
                val entry = "figures/$name"
                if(entry !in files) { files[entry] = figure; unpacked += figure.length() }
                require(unpacked <= BackupPolicy.MAX_ARCHIVE_BYTES) { "题库原图总大小超过 512 MB，请分批整理后备份" }
                return entry
            }
            if(!desktopFormat) {
            QuestionFigures.decode(q.figures).forEach { name -> archive(name)?.let { figures.getOrPut(q.id) { mutableListOf() } += it } }
            OptionFigures.decode(q.optionFigures).forEach { (label, names) ->
                val entries = names.mapNotNull(::archive)
                if(entries.isNotEmpty()) optionFigures.getOrPut(q.id) { mutableMapOf() }[label] = entries.toMutableList()
            }
        }
            }
        val data = LibraryBackupData(questions, snapshot.second.map { NativeDesktopAdapter.collection(it, snapshot.third) }, snapshot.third, knowledge.snapshot(), sources,
            questions.filter { it.solution.isNotBlank() && it.solutionFingerprint == it.contentFingerprint() }.map { it.id }.toSet(), missing,
            figures, missingFigures, optionFigures, desktopFormat)
        val manifest = LibraryBackupCodec.encode(data)
        require(unpacked + manifest.size <= BackupPolicy.MAX_ARCHIVE_BYTES) { "题库备份内容超过 512 MB" }
        val archive = temporary("library-export-")
        try {
            ZipOutputStream(archive.outputStream().buffered()).use { zip ->
                zip.putNextEntry(ZipEntry("manifest.json")); zip.write(manifest); zip.closeEntry()
                files.forEach { (entry, source) ->
                    zip.putNextEntry(ZipEntry(entry))
                    source.inputStream().use { input ->
                        val hash = copyChecked(input, zip, BackupPolicy.MAX_SOURCE_BYTES).second
                        check(hash == entry.substringAfter('/').substringBefore('.')) { "原图在备份期间发生变化，请重试" }
                    }
                    zip.closeEntry()
                }
            }
            require(archive.length() <= BackupPolicy.MAX_ARCHIVE_BYTES) { "题库备份文件超过 512 MB" }
            ExportedLibraryBackup(archive, summary(data))
        } catch(error: Throwable) { archive.delete(); throw error }
    }

    suspend fun exportTo(uri: Uri): BackupSummary = withContext(Dispatchers.IO) {
        createArchive().use { backup ->
            val output = context.contentResolver.openOutputStream(uri, "wt") ?: error("无法保存到所选位置，请重新选择")
            output.use { stream -> backup.file.inputStream().use { copyChecked(it, stream, BackupPolicy.MAX_ARCHIVE_BYTES) } }
            backup.summary
        }
    }

    suspend fun prepare(uri: Uri): PreparedLibraryBackup = withContext(Dispatchers.IO) {
        prepare(context.contentResolver.openInputStream(uri) ?: error("无法读取备份文件，请重新选择"))
    }

    suspend fun prepare(input: InputStream): PreparedLibraryBackup = withContext(Dispatchers.IO) {
        val archive = temporary("library-import-")
        try {
            input.use { stream -> archive.outputStream().use { copyChecked(stream, it, BackupPolicy.MAX_ARCHIVE_BYTES) } }
            ZipFile(archive).use { zip ->
                require(zip.size() <= BackupPolicy.MAX_ENTRIES) { "备份压缩包包含过多文件" }
                val entries = zip.entries().asSequence().toList()
                require(entries.size <= BackupPolicy.MAX_ENTRIES && entries.map { it.name }.distinct().size == entries.size) { "备份压缩包包含重复或过多文件" }
                require(entries.all { !it.isDirectory && BackupPolicy.allowedEntry(it.name) }) { "备份压缩包包含无效文件路径" }
                val manifest = zip.getEntry("manifest.json") ?: error("请选择 Matheca 导出的题库备份 ZIP 文件")
                require(manifest.size in 0..BackupPolicy.MAX_MANIFEST_BYTES) { "备份文字数据超过 32 MB" }
                var textBytes: ByteArray
                java.io.ByteArrayOutputStream().use { buffer ->
                    zip.getInputStream(manifest).use { copyChecked(it, buffer, BackupPolicy.MAX_MANIFEST_BYTES, expectedCrc = manifest.crc) }
                    textBytes = buffer.toByteArray()
                }
                val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                val data = LibraryBackupCodec.decode(decoder.decode(java.nio.ByteBuffer.wrap(textBytes)).toString())
                val referenced = data.sources.values.toSet() + data.figures.values.flatten().toSet() +
                    data.optionFigures.values.flatMap { group -> group.values.flatten() }.toSet()
                require(entries.map { it.name }.toSet() == referenced + "manifest.json") { "备份原图与题目关联不完整" }
                var total = textBytes.size.toLong()
                referenced.forEach { name ->
                    val entry = zip.getEntry(name) ?: error("备份缺少题目原图或题目图片")
                    require(entry.size in 0..BackupPolicy.MAX_SOURCE_BYTES) { "备份中有原图超过 50 MB" }
                    total += entry.size
                    require(total <= BackupPolicy.MAX_ARCHIVE_BYTES) { "备份解压内容超过 512 MB" }
                    zip.getInputStream(entry).use { source ->
                        val (bytes, hash) = copyChecked(source, null, BackupPolicy.MAX_SOURCE_BYTES, expectedCrc = entry.crc)
                        require(bytes == entry.size && hash == name.substringAfter('/').substringBefore('.')) { "备份原图已损坏，请选择完整备份" }
                    }
                }
                PreparedLibraryBackup(archive, data, summary(data))
            }
        } catch(error: Throwable) { archive.delete(); throw error }
    }

    suspend fun assess(backup: PreparedLibraryBackup): ExchangeAssessment = withContext(Dispatchers.IO) {
        val local = database.withTransaction { Triple(database.dao().backupQuestions(), database.dao().backupCollections(), database.dao().backupItems()) }
        assessment(backup.data, local.first, local.second, local.third)
    }
    private fun version(q: List<Question>, c: List<QuestionCollection>, i: List<CollectionItem>): String = DesktopPortable.hash(q.toString() + c.toString() + i.toString() + knowledge.snapshot().toString() + q.map { File(it.sourcePath).let { f -> "${f.length()}:${f.lastModified()}" } })
    private fun assessment(data: LibraryBackupData, qs: List<Question>, cs: List<QuestionCollection>, items: List<CollectionItem>): ExchangeAssessment {
        val details = data.questions.map { q ->
            val local = qs.find { it.id == q.id }
            val same = local != null && DesktopPortable.question(NativeDesktopAdapter.question(context, local), File(local.sourcePath).takeIf { it.isFile }?.let(DesktopPortable::sourceHash).orEmpty(), local.solution.isNotBlank() && local.solutionFingerprint == local.contentFingerprint()) == DesktopPortable.question(q, data.sources[q.id].orEmpty(), q.id in data.currentSolutions)
            ExchangeDetail("question", q.id, q.title, if(local == null) "new" else if(same) "same" else "conflict")
        } + data.collections.map { c -> val local = cs.find { it.id == c.id }; ExchangeDetail("collection", c.id, c.title, if(local == null) "new" else if(DesktopPortable.collection(NativeDesktopAdapter.collection(local, items), items) == DesktopPortable.collection(c, data.items)) "same" else "conflict") }
        return ExchangeAssessment(version(qs, cs, items), details)
    }
    suspend fun restore(backup: PreparedLibraryBackup, policy: String = "keep", expectedVersion: String? = null): RestoreResult = withContext(Dispatchers.IO) {
        require(policy in listOf("keep", "replace", "copy")) { "冲突处理方式无效" }
        val batch = File(sourceRoot, UUID.randomUUID().toString())
        var addedPoints = emptyList<CustomKnowledgePoint>()
        val createdImages = mutableListOf<File>()
        try {
            database.withTransaction {
                val dao = database.dao()
                val localQ = dao.backupQuestions(); val localC = dao.backupCollections(); val localI = dao.backupItems()
                if(expectedVersion != null) require(version(localQ, localC, localI) == expectedVersion) { "本机题库已变化，请重新预览" }
                val source = backup.data
                val assessment = if(policy == "copy") assessment(source, localQ, localC, localI) else null
                val qmap = source.questions.associate { q -> q.id to if(assessment?.details?.any { it.kind == "question" && it.id == q.id && it.status == "conflict" } == true) "exchange-" + DesktopPortable.hash(DesktopPortable.question(q, source.sources[q.id].orEmpty(), q.id in source.currentSolutions)).take(40) else q.id }
                val cmap = source.collections.associate { c -> c.id to if((assessment?.details?.any { it.kind == "collection" && it.id == c.id && it.status == "conflict" } == true || policy == "copy" && source.items.any { it.collectionId == c.id && qmap[it.questionId] != it.questionId })) "exchange-" + DesktopPortable.hash(DesktopPortable.collection(c, source.items)).take(40) else c.id }
                val data = source.copy(questions = source.questions.map { it.copy(id = qmap.getValue(it.id)) },
                    collections = source.collections.map { c -> val layout = org.json.JSONObject(c.questionLayoutJson); val mapped = org.json.JSONObject(); layout.keys().forEach { mapped.put(qmap[it] ?: it, layout.get(it)) }; c.copy(id = cmap.getValue(c.id), questionLayoutJson = mapped.toString()) },
                    items = source.items.map { it.copy(questionId = qmap.getValue(it.questionId), collectionId = cmap.getValue(it.collectionId)) },
                    figures = source.figures.mapKeys { qmap.getValue(it.key) }, optionFigures = source.optionFigures.mapKeys { qmap.getValue(it.key) },
                    sources = source.sources.mapKeys { qmap.getValue(it.key) }, currentSolutions = source.currentSolutions.map { qmap.getValue(it) }.toSet())
                val plan = if(policy == "replace") LibraryRestorePlan(data.questions, data.collections, data.items, 0, 0) else LibraryRestorePlan.merge(data, localQ.map { it.id }.toSet(), localC.map { it.id }.toSet())
                val copied = mutableMapOf<String, String>()
                ZipFile(backup.file).use { zip ->
                    plan.questions.mapNotNull { data.sources[it.id] }.distinct().forEach { name ->
                        check(batch.mkdirs() || batch.isDirectory) { "无法创建原图恢复目录" }
                        val target = File(batch, name.substringAfter('/'))
                        val entry = zip.getEntry(name) ?: error("备份缺少原图")
                        zip.getInputStream(entry).use { input -> target.outputStream().use { output ->
                            val hash = copyChecked(input, output, BackupPolicy.MAX_SOURCE_BYTES, expectedCrc = entry.crc).second
                            require(hash == name.substringAfter('/').substringBefore('.')) { "备份原图校验失败" }
                        } }
                        copied[name] = target.absolutePath
                    }
                    val images = QuestionFigures.root(context)
                    plan.questions.flatMap { data.figures[it.id].orEmpty() + data.optionFigures[it.id].orEmpty().values.flatten() }.distinct().forEach { name ->
                        val target = QuestionFigures.file(context, name.substringAfter('/'))
                        if(target.isFile) return@forEach
                        check(images.mkdirs() || images.isDirectory) { "无法创建题目图片目录" }
                        val entry = zip.getEntry(name) ?: error("备份缺少题目图片")
                        zip.getInputStream(entry).use { input -> target.outputStream().use { output ->
                            val hash = copyChecked(input, output, BackupPolicy.MAX_SOURCE_BYTES, expectedCrc = entry.crc).second
                            require(hash == name.substringAfter('/').substringBefore('.')) { "备份题目图片校验失败" }
                        } }
                    }
                }
                addedPoints = knowledge.merge(data.customPoints)
                plan.questions.forEach { q ->
                    val figures = QuestionFigures.encode(data.figures[q.id].orEmpty().map { it.substringAfter('/') })
                    val optionFigures = OptionFigures.encode(data.optionFigures[q.id].orEmpty().mapValues { (_, names) -> names.map { it.substringAfter('/') } })
                    val nativeRecord = q.copy(sourcePath = data.sources[q.id]?.let(copied::get).orEmpty(), figures = figures, optionFigures = optionFigures)
                    val portable = if(figures.isNotEmpty() || optionFigures.isNotEmpty()) nativeRecord else NativeDesktopAdapter.materialize(context, nativeRecord, createdImages)
                    dao.save(portable.copy(solutionFingerprint = if(q.id in data.currentSolutions) portable.contentFingerprint() else ""))
                }
                plan.collections.forEach { if(policy == "replace") dao.clearItems(it.id); dao.save(it) }
                plan.items.forEach { dao.add(it) }
                RestoreResult(plan.questions.size, plan.collections.size, plan.skippedQuestions, plan.skippedCollections, addedPoints.size)
            }
        } catch(error: Throwable) {
            runCatching { knowledge.rollbackMerge(addedPoints) }.exceptionOrNull()?.let(error::addSuppressed)
            createdImages.forEach { it.delete() }
            batch.deleteRecursively()
            throw error
        }
    }

    private fun summary(data: LibraryBackupData) = BackupSummary(data.questions.size, data.collections.size, data.sources.values.distinct().size, data.customPoints.size, data.missingSources,
        (data.figures.values.flatten() + data.optionFigures.values.flatMap { group -> group.values.flatten() }).distinct().size, data.missingFigures)

    private suspend fun copyChecked(input: InputStream, output: OutputStream?, limit: Long, expectedCrc: Long? = null): Pair<Long, String> {
        val digest = MessageDigest.getInstance("SHA-256")
        val crc = CRC32()
        val buffer = ByteArray(16 * 1024)
        var total = 0L
        while(true) {
            currentCoroutineContext().ensureActive()
            val size = input.read(buffer)
            if(size < 0) break
            total += size
            require(total <= limit) { "备份文件超过允许的大小" }
            digest.update(buffer, 0, size); crc.update(buffer, 0, size); output?.write(buffer, 0, size)
        }
        require(expectedCrc == null || crc.value == expectedCrc) { "备份文件校验失败，请重新选择" }
        return total to digest.digest().joinToString("") { "%02x".format(it) }
    }
}
