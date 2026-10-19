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

    suspend fun createArchive(): ExportedLibraryBackup = withContext(Dispatchers.IO) {
        val dao = database.dao()
        val snapshot = database.withTransaction { Triple(dao.backupQuestions(), dao.backupCollections(), dao.backupItems()) }
        BackupPolicy.validateReferences(snapshot.first, snapshot.second, snapshot.third)
        val questions = snapshot.first
        val files = linkedMapOf<String, File>()
        val sources = mutableMapOf<String, String>()
        var missing = 0
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
        }
        val data = LibraryBackupData(questions, snapshot.second, snapshot.third, knowledge.snapshot(), sources,
            questions.filter { it.solution.isNotBlank() && it.solutionFingerprint == it.contentFingerprint() }.map { it.id }.toSet(), missing)
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
                require(zip.size() <= BackupPolicy.MAX_QUESTIONS + 1) { "备份压缩包包含过多文件" }
                val entries = zip.entries().asSequence().toList()
                require(entries.size <= BackupPolicy.MAX_QUESTIONS + 1 && entries.map { it.name }.distinct().size == entries.size) { "备份压缩包包含重复或过多文件" }
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
                val referenced = data.sources.values.toSet()
                require(entries.map { it.name }.toSet() == referenced + "manifest.json") { "备份原图与题目关联不完整" }
                var total = textBytes.size.toLong()
                referenced.forEach { name ->
                    val entry = zip.getEntry(name) ?: error("备份缺少题目原图")
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

    suspend fun restore(backup: PreparedLibraryBackup): RestoreResult = withContext(Dispatchers.IO) {
        val data = backup.data
        val batch = File(sourceRoot, UUID.randomUUID().toString())
        var addedPoints = emptyList<CustomKnowledgePoint>()
        try {
            database.withTransaction {
                val dao = database.dao()
                val plan = LibraryRestorePlan.merge(data, dao.backupQuestions().map { it.id }.toSet(), dao.backupCollections().map { it.id }.toSet())
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
                }
                addedPoints = knowledge.merge(data.customPoints)
                plan.questions.forEach { q ->
                    val portable = q.copy(sourcePath = data.sources[q.id]?.let(copied::get).orEmpty())
                    dao.save(portable.copy(solutionFingerprint = if(q.id in data.currentSolutions) portable.contentFingerprint() else ""))
                }
                plan.collections.forEach { dao.save(it) }
                plan.items.forEach { dao.add(it) }
                RestoreResult(plan.questions.size, plan.collections.size, plan.skippedQuestions, plan.skippedCollections, addedPoints.size)
            }
        } catch(error: Throwable) {
            runCatching { knowledge.rollbackMerge(addedPoints) }.exceptionOrNull()?.let(error::addSuppressed)
            batch.deleteRecursively()
            throw error
        }
    }

    private fun summary(data: LibraryBackupData) = BackupSummary(data.questions.size, data.collections.size, data.sources.values.distinct().size, data.customPoints.size, data.missingSources)

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
