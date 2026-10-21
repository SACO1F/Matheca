package com.mathector.app

import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.*
import androidx.room.withTransaction
import com.mathector.app.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.io.File
import java.util.UUID

class AppViewModel(private val application: MathectorApplication) : ViewModel() {
    private val dao = application.database.dao()
    val questions = dao.questions().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val collections = dao.collections().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val items = dao.items().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val jobs = dao.imports().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val notice = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)
    val backupProgress = MutableStateFlow<String?>(null)
    val pendingBackup = MutableStateFlow<PreparedLibraryBackup?>(null)
    val desktopLink = DesktopLinkService(application)
    init { desktopLink.inventoryProvider = { backupService.exchangeInventory() } }
    val desktopBusy = MutableStateFlow(false)
    val desktopError = MutableStateFlow<String?>(null)
    val desktopPreview = MutableStateFlow<PreparedLibraryBackup?>(null)
    val desktopAssessment = MutableStateFlow<ExchangeAssessment?>(null)
    private fun desktopTask(action: suspend () -> Unit) {
        if(desktopBusy.value) return
        desktopBusy.value = true; desktopError.value = null
        viewModelScope.launch { try { action() } catch(cancel: CancellationException) { throw cancel } catch(error: Exception) { desktopError.value = error.message ?: "操作失败，请重试" } finally { desktopBusy.value = false } }
    }
    fun desktopConnect(link: String) = desktopTask {
        val parsed=DesktopConnection.parse(link)
        val saved=desktopLink.savedDesktops.value.find { it.base==parsed.base && it.credential==parsed.token }
        if(saved!=null) desktopLink.reconnect(saved.id) else desktopLink.connect(link)
    }
    fun desktopReconnect(id: String) = desktopTask { desktopLink.reconnect(id) }
    fun desktopRemember() = desktopTask { desktopLink.remember(); message("已保存电脑，下次开启电脑手机联动后可再次连接") }
    fun desktopForget(id: String) = desktopTask { desktopLink.forget(id) }
    fun desktopPoll(refreshInventory: Boolean = false) { if(desktopBusy.value) return; viewModelScope.launch { runCatching { desktopLink.poll(refreshInventory) }.onSuccess { desktopError.value = null }.onFailure { desktopError.value = it.message ?: "电脑连接中断，请重新扫码" } } }
    fun desktopPhotos(uris: List<Uri>) = desktopTask { desktopLink.addPhotos(uris); message("照片已保存到本机待传队列") }
    fun desktopQueueSelection(questionIds: Set<String>, collectionIds: Set<String>, changedOnly: Boolean = false) = desktopTask {
        require(questionIds.isNotEmpty() || collectionIds.isNotEmpty()) { "请先选择题目或题集" }
        val chosen=if(changedOnly) backupService.changedSelection(questionIds,collectionIds,desktopLink.remoteInventory()) else questionIds to collectionIds
        require(chosen.first.isNotEmpty() || chosen.second.isNotEmpty()) { "所选资料与电脑一致，无需发送" }
        backupService.createArchive(chosen.first, chosen.second).use { archive -> desktopLink.addLibrary(archive.file, "题库资料-${java.text.SimpleDateFormat("MMdd-HHmmss", java.util.Locale.ROOT).format(java.util.Date())}.zip") }
        message("已保存到待传队列，可离线保留后再连接电脑发送")
    }
    fun desktopExportSelection(uri: Uri, questionIds: Set<String>, collectionIds: Set<String>) = desktopTask {
        require(questionIds.isNotEmpty() || collectionIds.isNotEmpty()) { "请先选择题目或题集" }
        backupService.createArchive(questionIds, collectionIds).use { archive ->
            withContext(Dispatchers.IO) {
                val output = application.contentResolver.openOutputStream(uri, "wt") ?: error("无法保存到所选位置")
                output.use { target -> archive.file.inputStream().use { it.copyTo(target) } }
            }
        }
        message("已导出桌面标准 ZIP，可在电脑的题库备份中导入")
    }
    fun desktopSend() = desktopTask { desktopLink.send() }
    fun desktopRemove(id: String) = desktopTask { desktopLink.remove(id) }
    fun desktopMove(id: String, delta: Int) = desktopTask { desktopLink.move(id, delta) }
    fun desktopDownload(id: String, size: Long) = desktopTask {
        val file = desktopLink.downloadLibrary(id, size)
        try {
            val prepared = backupService.prepare(file.inputStream())
            try { val assessment = backupService.assess(prepared); desktopPreview.value?.close(); desktopPreview.value = prepared; desktopAssessment.value = assessment }
            catch(error: Throwable) { prepared.close(); throw error }
        } finally { file.delete() }
    }
    fun desktopDismiss() { if(!desktopBusy.value) { desktopPreview.value?.close(); desktopPreview.value = null; desktopAssessment.value = null } }
    fun desktopRestore(policy: String) = desktopTask {
        val pending = desktopPreview.value ?: error("请先预览资料")
        val assessment = desktopAssessment.value ?: error("请重新预览")
        backupService.restore(pending, policy, assessment.version)
        runCatching { desktopLink.poll(true) }
        pending.close(); desktopPreview.value = null; desktopAssessment.value = null; message("资料已接收，未触发识别或解题")
    }
    private val backupService by lazy { LibraryBackupService(application, application.database, application.knowledge) }
    private var backupJob: Job? = null
    val settings = application.settings.state
    val testingApi = MutableStateFlow(false)
    val apiTestResult = MutableStateFlow<String?>(null)
    val solutionJobs = WorkManager.getInstance(application).getWorkInfosByTagFlow("solutions").map { work ->
        work.filter { it.state in listOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED) }
            .mapNotNull { info -> info.tags.firstOrNull { it.startsWith("solution-") }?.removePrefix("solution-")?.let { it to info.state } }.toMap()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyMap())
    fun setTheme(mode: ThemeMode) = viewModelScope.launch(Dispatchers.IO) { runCatching { application.settings.setTheme(mode) }.onFailure { message(it.message ?: "主题保存失败") } }
    fun setAccent(accent: AccentTheme) = viewModelScope.launch(Dispatchers.IO) { runCatching { application.settings.setAccent(accent) }.onFailure { message(it.message ?: "配色保存失败") } }
    fun setAutoSolveImports(enabled: Boolean) = viewModelScope.launch(Dispatchers.IO) { runCatching { application.settings.setAutoSolveImports(enabled) }.onFailure { message("自动解题设置保存失败") } }
    fun saveApi(address: String, model: String, key: String, done: () -> Unit) = viewModelScope.launch {
        try {
            withContext(Dispatchers.IO) { application.settings.saveApi(address, model, key) }
            apiTestResult.value = null
            done(); message("接口配置已保存")
        } catch (error: Exception) { message(error.message ?: "接口配置保存失败") }
    }
    fun clearApiKey() = viewModelScope.launch(Dispatchers.IO) {
        runCatching { application.settings.clearApiKey(); apiTestResult.value = null }.onFailure { message("API Key 清除失败") }
    }
    fun testApi() = viewModelScope.launch {
        if (testingApi.value) return@launch
        testingApi.value = true; apiTestResult.value = "正在验证模型的图片识别能力…"
        try {
            val result = withContext(Dispatchers.IO) {
                val config = application.settings.multimodalConfig()
                val image = File(application.cacheDir, "api-vision-test.jpg")
                val bitmap = android.graphics.Bitmap.createBitmap(900, 400, android.graphics.Bitmap.Config.ARGB_8888)
                try {
                    android.graphics.Canvas(bitmap).apply {
                        drawColor(android.graphics.Color.WHITE)
                        drawText("1. Solve x + 2 = 5.", 48f, 170f, android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.BLACK; textSize = 58f })
                    }
                    image.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, it) }
                } finally { bitmap.recycle() }
                try { MultimodalRecognitionEngine(config).use { it.recognize(image) } }
                finally { image.delete() }
            }
            apiTestResult.value = "图片识别测试通过，返回 ${result.questions.size} 道题目"
        } catch (cancel: CancellationException) { throw cancel }
        catch (error: Exception) { apiTestResult.value = error.message ?: "接口测试失败" }
        finally { testingApi.value = false }
    }
    fun clearNotice() { notice.value = null }
    fun message(text: String) { notice.value = text }
    private fun backupTask(progress: String, action: suspend () -> Unit) {
        if(backupProgress.value != null) return
        backupProgress.value = progress
        backupJob = viewModelScope.launch {
            try { action() }
            catch(cancel: CancellationException) { message("题库备份操作已取消") }
            catch(error: Exception) { message(error.message ?: "题库备份操作失败，请重试") }
            finally { backupProgress.value = null }
        }
    }
    fun exportLibrary(uri: Uri) = backupTask("正在打包并保存题库…") {
        val summary = backupService.exportTo(uri)
        val missing = listOfNotNull(
            if(summary.missingImages > 0) "${summary.missingImages} 道题的原图" else null,
            if(summary.missingFigures > 0) "${summary.missingFigures} 张题目图片" else null).joinToString("、")
        message("已备份 ${summary.questions} 道题、${summary.collections} 个题集" +
            (if(summary.figures > 0) "、${summary.figures} 张题目图片" else "") +
            if(missing.isNotEmpty()) "；$missing 已缺失，题干已保留" else "，请保留这份 ZIP 文件")
    }
    fun inspectLibrary(uri: Uri) = backupTask("正在检查题库备份与原图…") {
        pendingBackup.value?.close()
        pendingBackup.value = null
        pendingBackup.value = backupService.prepare(uri)
    }
    fun cancelBackup() { backupJob?.cancel() }
    fun dismissBackupImport() { pendingBackup.value?.close(); pendingBackup.value = null }
    fun restoreLibrary() {
        val pending = pendingBackup.value ?: return
        backupTask("正在恢复题目、原图和题集…") {
            try {
                val result = backupService.restore(pending)
                message("已导入 ${result.questions} 道题、${result.collections} 个题集" +
                    if(result.skippedQuestions + result.skippedCollections > 0) "，跳过 ${result.skippedQuestions} 道已有题目、${result.skippedCollections} 个已有题集" else "")
            } finally { if(pendingBackup.value === pending) pendingBackup.value = null; pending.close() }
        }
    }
    override fun onCleared() { desktopLink.disconnect(); desktopPreview.value?.close(); pendingBackup.value?.close(); super.onCleared() }
    fun save(question: Question, done: () -> Unit) = viewModelScope.launch { persistEdit(question); done() }
    private suspend fun persistEdit(question: Question, scheduleAuto: Boolean = true): Question {
        var previous: Question? = null
        val saved = application.database.withTransaction {
            previous = dao.question(question.id)
            val old = previous
            var current = KnowledgeCatalog.normalize(question)
            if(old != null && (old.figures != current.figures || old.optionFigures != current.optionFigures) &&
                QuestionFigures.decode(current.figures).isEmpty() && OptionFigures.names(current.optionFigures).isEmpty()) {
                current = current.copy(figuresJson = "[]", figureWidthsJson = "[]", figurePlacementsJson = "[]")
            }
            val same = old != null && old.contentFingerprint() == current.contentFingerprint()
            val edited = current.copy(solution = if(same) old!!.solution else "", solutionLatex = if(same) old!!.solutionLatex else "",
                solutionFingerprint = if(same) old!!.solutionFingerprint else "", solutionError = if(same) old!!.solutionError else "")
            dao.save(edited); edited
        }
        val removedFigures = (QuestionFigures.decode(previous?.figures.orEmpty()) + OptionFigures.names(previous?.optionFigures.orEmpty()))
            .filter { it !in QuestionFigures.decode(saved.figures) && it !in OptionFigures.names(saved.optionFigures) }
        if (removedFigures.isNotEmpty()) QuestionFigures.delete(application, removedFigures)
        val contentChanged = previous?.contentFingerprint() != saved.contentFingerprint()
        if (previous?.autoSolve == true && !saved.autoSolve || contentChanged) SolutionScheduler.cancel(application, saved.id)
        if (scheduleAuto && saved.autoSolve && (previous?.autoSolve != true || contentChanged) && (saved.body.isNotBlank() || saved.latex.isNotBlank())) enqueueSolution(saved)
        return saved
    }
    private suspend fun enqueueSolution(question: Question) {
        if (!settings.value.hasApiKey || settings.value.address.isBlank() || settings.value.model.isBlank()) {
            dao.saveSolution(question.id, question.contentFingerprint(), null, "请先在“我的”中配置多模态接口，再点击生成解答")
            return
        }
        SolutionScheduler.enqueue(application, question)
    }
    fun requestSolution(question: Question) = viewModelScope.launch { enqueueSolution(persistEdit(question, scheduleAuto = false)) }
    fun cancelSolution(id: String) { SolutionScheduler.cancel(application, id) }
    fun toggleFavorite(question: Question) = viewModelScope.launch { dao.save(question.copy(favorite = !question.favorite)) }
    fun delete(id: String, done: () -> Unit) = viewModelScope.launch {
        SolutionScheduler.cancel(application, id)
        val figures = (QuestionFigures.decode(dao.question(id)?.figures.orEmpty()) + OptionFigures.names(dao.question(id)?.optionFigures.orEmpty())).distinct()
        dao.deleteQuestion(id)
        QuestionFigures.delete(application, figures)
        done()
    }
    fun createCollection(title: String) = viewModelScope.launch { if (title.isNotBlank()) dao.save(QuestionCollection(title = title.trim(), paperTitle = title.trim().take(80))) }
    suspend fun savePaperSettings(id: String, settings: PaperSettings) {
        val paper = settings.validated()
        dao.savePaperSettings(id, paper.title, paper.instructions, paper.minutes, paper.totalScore)
    }
    fun updatePaperSettings(id: String, settings: PaperSettings) = viewModelScope.launch {
        runCatching { savePaperSettings(id, settings) }.onFailure { message(it.message ?: "试卷设置保存失败") }
    }
    fun add(collectionId: String, questionId: String) = viewModelScope.launch { dao.addToCollection(collectionId, questionId) }
    fun addQuestions(collectionId: String, questionIds: List<String>) = viewModelScope.launch {
        try { val count = dao.addQuestions(collectionId, questionIds); message("已添加 $count 道题") }
        catch (cancel: CancellationException) { throw cancel }
        catch (_: Exception) { message("添加失败，请重新打开题集后重试") }
    }
    fun remove(collectionId: String, questionId: String) = viewModelScope.launch { dao.remove(collectionId, questionId) }
    fun move(collectionId: String, questionId: String, delta: Int) = viewModelScope.launch { dao.move(collectionId, questionId, delta) }
    fun updateItemLayout(collectionId: String, questionId: String, space: Int, newPage: Boolean) = viewModelScope.launch {
        runCatching { application.database.withTransaction {
            dao.setItemLayout(collectionId, questionId, space, newPage)
            val c = dao.backupCollections().find { it.id == collectionId } ?: return@withTransaction
            val layout = org.json.JSONObject(c.questionLayoutJson)
            val value = org.json.JSONObject()
            if(space >= 0) value.put("answerSpaceMm", space)
            if(newPage) value.put("pageBreakBefore", true)
            if(value.length() > 0) layout.put(questionId, value) else layout.remove(questionId)
            dao.save(c.copy(questionLayoutJson = layout.toString()))
        } }.onFailure { message("解答空间保存失败") }
    }
    fun deleteCollection(id: String) = viewModelScope.launch { dao.deleteCollection(id) }
    fun examples() = viewModelScope.launch {
        listOf(
            Question(id = "example-high-function", title = "函数的单调性与最值", body = "已知函数 f(x) = x² − 4x + 3，x ∈ [0, 3]。\n（1）求函数的单调区间；\n（2）求函数在该区间上的最小值。", latex = "f(x)=(x-2)^2-1", grade = "高一", knowledge = "函数的概念与性质、函数单调性", difficulty = "基础", reviewed = true, example = true),
            Question(id = "example-high-sequence", title = "等差数列的通项与求和", body = "已知等差数列的首项 a₁ = 2，公差 d = 3。\n（1）求通项公式 aₙ；\n（2）求前 10 项和 S₁₀。", latex = "a_n=a_1+(n-1)d", grade = "高二", knowledge = "等差数列、数列通项、数列求和", difficulty = "基础", reviewed = true, example = true),
            Question(id = "example-high-vector", title = "平面向量的数量积", body = "已知向量 a = (1, 2)，b = (3, −1)。\n（1）求 a·b；\n（2）判断两向量是否垂直并说明理由。", latex = "\\vec a\\cdot\\vec b=x_1x_2+y_1y_2", grade = "高一", knowledge = "向量数量积、平面向量坐标运算", difficulty = "进阶", reviewed = true, example = true),
        ).forEach { if (dao.question(it.id) == null) dao.save(KnowledgeCatalog.normalize(it)) }
        notice.value = "已添加 3 道示例题，示例均有标记"
    }
    fun importUris(uris: List<Uri>) = viewModelScope.launch {
        if (uris.isEmpty()) return@launch
        if (!settings.value.recognitionReady) { message("请先在“我的”中配置多模态接口，填写地址、API Key 和模型名"); return@launch }
        busy.value = true
        try {
            require(uris.size <= 20) { "每次最多导入 20 个文件" }
            val jobId = UUID.randomUUID().toString()
            val paths = withContext(Dispatchers.IO) {
                val dir = File(application.filesDir, "sources/$jobId").apply { mkdirs() }
                uris.mapIndexed { index, uri ->
                    val name = application.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null } ?: "图片.jpg"
                    val extension = name.substringAfterLast('.', "jpg").lowercase()
                    require(extension in setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "pdf")) { "当前支持图片和 PDF 文件" }
                    val safeName = name.replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").take(100).ifBlank { "图片.$extension" }
                    val output = File(dir, "$index-$safeName")
                    try {
                        application.contentResolver.openInputStream(uri)?.use { input -> output.outputStream().use { stream ->
                            val buffer = ByteArray(8192); var total = 0L
                            while (true) { val length = input.read(buffer); if (length < 0) break; total += length; require(total <= 50L * 1024 * 1024) { "单个文件不能超过 50 MB" }; stream.write(buffer, 0, length) }
                        } } ?: error("无法读取文件，请重新选择")
                        output.absolutePath
                    } catch (error: Exception) { output.delete(); throw error }
                }
            }
            dao.save(ImportJob(id = jobId, paths = paths.joinToString("\n")))
            enqueue(jobId)
            notice.value = "已导入 ${uris.size} 个文件，等待网络进行多模态识别"
        } catch (error: Exception) { notice.value = error.message ?: "导入失败" }
        finally { busy.value = false }
    }
    fun retry(jobId: String) = viewModelScope.launch {
        if (!settings.value.recognitionReady) { message("请先在“我的”中配置识别接口"); return@launch }
        dao.importJob(jobId)?.let { dao.save(it.copy(status = "queued", message = "等待重试")); enqueue(jobId) }
    }
    private fun enqueue(jobId: String) {
        WorkManager.getInstance(application).enqueueUniqueWork("import-$jobId", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<ImportWorker>().setInputData(workDataOf("jobId" to jobId, "autoSolve" to settings.value.autoSolveImports))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    }
}
