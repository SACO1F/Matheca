package com.mathector.app.ui

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.mathector.app.AppViewModel
import com.mathector.app.data.*
import dev.chrisbanes.haze.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID

private val Blue = Color(0xFF3269E8)
private val Ink = Color(0xFF172339)
private val Soft = Color(0xFFF3F5F9)
private val Muted = Color(0xFF798497)
private val CardShape = RoundedCornerShape(24.dp)

private data class CollectionExportRequest(val collection: QuestionCollection, val ordered: List<Question>, val word: Boolean, val paper: PaperSettings)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MathectorApp(model: AppViewModel) {
    val context = LocalContext.current
    val settings by model.settings.collectAsStateWithLifecycle()
    val dark = when(settings.theme) { ThemeMode.SYSTEM -> isSystemInDarkTheme(); ThemeMode.LIGHT -> false; ThemeMode.DARK -> true }
    val view = LocalView.current
    SideEffect {
        (view.context as? Activity)?.window?.let { window ->
            WindowCompat.getInsetsController(window, view).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
        }
    }
    val colors = if (dark) darkColorScheme(primary = Color(0xFF9AB7FF), secondary = Color(0xFF9AB7FF), secondaryContainer = Color(0xFF263656), onSecondaryContainer = Color(0xFFC5D6FF), background = Color(0xFF10151F), surface = Color(0xFF1C2330), onSurface = Color(0xFFE9EEF7))
        else lightColorScheme(primary = Blue, secondary = Blue, secondaryContainer = Color(0xFFE6EDFF), onSecondaryContainer = Blue, background = Soft, surface = Color.White, onSurface = Ink)
    MaterialTheme(colorScheme = colors, typography = Typography()) {
        val questions by model.questions.collectAsStateWithLifecycle()
        val collections by model.collections.collectAsStateWithLifecycle()
        val items by model.items.collectAsStateWithLifecycle()
        val jobs by model.jobs.collectAsStateWithLifecycle()
        val notice by model.notice.collectAsStateWithLifecycle()
        val busy by model.busy.collectAsStateWithLifecycle()
        val backupProgress by model.backupProgress.collectAsStateWithLifecycle()
        val pendingBackup by model.pendingBackup.collectAsStateWithLifecycle()
        val solutionJobs by model.solutionJobs.collectAsStateWithLifecycle()
        var tab by rememberSaveable { mutableIntStateOf(0) }
        var editorId by rememberSaveable { mutableStateOf<String?>(null) }
        var collectionId by rememberSaveable { mutableStateOf<String?>(null) }
        var showAdd by remember { mutableStateOf(false) }
        var showCamera by remember { mutableStateOf(false) }
        var showNewCollection by remember { mutableStateOf(false) }
        var showLibraryBackup by rememberSaveable { mutableStateOf(false) }
        var addQuestionId by remember { mutableStateOf<String?>(null) }
        var exportingId by remember { mutableStateOf<String?>(null) }
        val exporting = exportingId != null
        var pendingExport by remember { mutableStateOf<CollectionExportRequest?>(null) }
        var exportFile by remember { mutableStateOf<File?>(null) }
        var previewFile by remember { mutableStateOf<File?>(null) }
        val scope = rememberCoroutineScope()
        val orderedQuestions: (String) -> List<Question> = { id ->
            items.filter { it.collectionId == id }.sortedBy { it.position }.mapNotNull { item -> questions.find { it.id == item.questionId } }
        }
        val generateDocument: (CollectionExportRequest) -> Unit = { request ->
            if (exportingId == null) {
                exportingId = request.collection.id
                scope.launch {
                    try {
                        model.savePaperSettings(request.collection.id, request.paper)
                        exportFile = DocumentExporter.export(context, request.collection.title, request.ordered, request.word, request.paper)
                    } catch (cancel: CancellationException) { throw cancel }
                    catch (error: Exception) { model.message("导出失败：${error.message}") }
                    finally { exportingId = null }
                }
            }
        }
        val requestExport: (CollectionExportRequest) -> Unit = { request ->
            when {
                exportingId != null -> Unit
                request.ordered.isEmpty() -> model.message("请先添加题目再导出")
                request.ordered.any { !it.reviewed } -> pendingExport = request
                else -> generateDocument(request)
            }
        }
        val snackbar = remember { SnackbarHostState() }
        val haze = remember { HazeState() }
        val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { model.importUris(it) }
        val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { model.importUris(it) }
        val exportLibrary = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> uri?.let(model::exportLibrary) }
        val importLibrary = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(model::inspectLibrary) }
        val beginLibraryExport = {
            showLibraryBackup = false
            val date = java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.ROOT).format(java.util.Date())
            exportLibrary.launch("Matheca题库-$date.zip")
        }
        val beginLibraryImport = {
            showLibraryBackup = false
            importLibrary.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream"))
        }
        val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) showCamera = true else model.message("相机权限未开启，可使用相册或文件录入") }
        val saveDocument = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uri = result.data?.data
            val source = exportFile
            if (uri != null && source != null) scope.launch {
                runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { output -> source.inputStream().use { it.copyTo(output) } } ?: error("无法写入目标位置") } }
                    .onSuccess { model.message("文档已保存") }.onFailure { model.message(it.message ?: "保存失败") }
            }
        }
        LaunchedEffect(notice) { notice?.let { snackbar.showSnackbar(it); model.clearNotice() } }
        if (showCamera) { CameraScreen(onClose = { showCamera = false }, onCaptured = { showCamera = false; model.importUris(listOf(it)) }, onError = model::message); return@MaterialTheme }
        BackHandler(enabled = previewFile != null || editorId != null || collectionId != null || tab != 0) {
            when { previewFile != null -> previewFile = null; editorId != null -> editorId = null; collectionId != null -> collectionId = null; else -> tab = 0 }
        }
        Scaffold(containerColor = MaterialTheme.colorScheme.background, snackbarHost = { SnackbarHost(snackbar, Modifier.padding(bottom = 82.dp)) }) { insets ->
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().hazeSource(haze).padding(top = insets.calculateTopPadding())) {
                    when {
                        previewFile != null -> PdfPreview(previewFile!!, onBack = { previewFile = null })
                        editorId != null -> key(editorId) {
                            val q = questions.firstOrNull { it.id == editorId } ?: Question(id = editorId!!)
                            QuestionEditor(q, dark, solutionJobs[q.id], onGenerate = model::requestSolution, onCancel = { model.cancelSolution(q.id) },
                                onBack = { editorId = null }, onSave = { model.save(it) { editorId = null; model.message("题目已保存并标记为已校对") } },
                                onDraft = { model.save(it) {} }, onDelete = { model.delete(q.id) { editorId = null } }, onAdd = { model.save(it) { addQuestionId = it.id } })
                        }
                        collectionId != null -> {
                            val collection = collections.firstOrNull { it.id == collectionId }
                            if (collection != null) {
                                val ordered = orderedQuestions(collection.id)
                                CollectionDetail(collection, ordered, questions, exporting, onBack = { collectionId = null }, onEdit = { editorId = it.id },
                                    onAdd = { model.addQuestions(collection.id, it) }, onRemove = { model.remove(collection.id, it) }, onMove = { id, delta -> model.move(collection.id, id, delta) },
                                    onPaperChange = { model.updatePaperSettings(collection.id, it) },
                                    onExport = { word, paper -> requestExport(CollectionExportRequest(collection, ordered, word, paper)) })
                            }
                        }
                        else -> AnimatedContent(tab, modifier = Modifier.fillMaxSize(), transitionSpec = {
                            val direction = if(targetState > initialState) 1 else -1
                            (slideInHorizontally(tween(260, easing = FastOutSlowInEasing)) { it * direction } + fadeIn(tween(180))) togetherWith
                                (slideOutHorizontally(tween(260, easing = FastOutSlowInEasing)) { -it * direction } + fadeOut(tween(140)))
                        }, label = "main-page-slide") { selectedTab ->
                            when(selectedTab) {
                                0 -> LibraryScreen(questions, jobs.firstOrNull(), busy, onEdit = { editorId = it.id }, onAdd = { showAdd = true }, onExample = model::examples, onFavorite = model::toggleFavorite, onAddToCollection = { addQuestionId = it }, onRetry = model::retry, onBackup = { showLibraryBackup = true })
                                1 -> CollectionsScreen(collections, items, exportingId, onOpen = { collectionId = it }, onCreate = { showNewCollection = true }, onDelete = model::deleteCollection,
                                    onExport = { collection, word -> requestExport(CollectionExportRequest(collection, orderedQuestions(collection.id), word, collection.paperSettings())) })
                                else -> SettingsScreen(questions.size, jobs, settings, model, beginLibraryExport, beginLibraryImport)
                            }
                        }
                    }
                }
                if (previewFile == null && editorId == null && collectionId == null) {
                    Row(Modifier.align(Alignment.BottomCenter).widthIn(max = 360.dp).fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GlassPanel(haze, Modifier.weight(1f).height(52.dp).testTag("floating-navigation"), dark) {
                            SlidingNavigation(tab) { tab = it }
                        }
                        GlassActionSurface(haze, dark, Modifier.size(50.dp).testTag("main-add-floating"), CircleShape, { showAdd = true }) {
                            Icon(Icons.Rounded.Add, "添加题目", Modifier.size(24.dp), tint = it)
                        }
                    }
                }
            }
        }
        if (showAdd) ModalBottomSheet(onDismissRequest = { showAdd = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = MaterialTheme.colorScheme.surface) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("收录一道好题", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Text("识别后对照原图校对，再归入题库", color = Muted); Spacer(Modifier.height(8.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("导入后自动解题", fontWeight = FontWeight.SemiBold); Text("默认关闭 · 开启后生成答案和步骤", fontSize = 12.sp, color = Muted) }
                    Switch(settings.autoSolveImports, model::setAutoSolveImports, Modifier.testTag("auto-solve-import"))
                }
                if (!settings.recognitionReady) {
                    Text("请先配置多模态接口，填写地址、API Key 和模型名", fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
                    TextButton(onClick = { showAdd = false; tab = 2 }) { Text("配置识别接口") }
                }
                ActionRow(Icons.Rounded.CameraAlt, "拍照录入", "拍摄纸面题目或试卷") { showAdd = false; if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) showCamera = true else cameraPermission.launch(Manifest.permission.CAMERA) }
                ActionRow(Icons.Rounded.PhotoLibrary, "相册上传", "选择多张图片，批量识别") { showAdd = false; picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
                ActionRow(Icons.Rounded.UploadFile, "文件上传", "图片或 PDF，每次最多 20 页") { showAdd = false; files.launch(arrayOf("image/*", "application/pdf")) }
                ActionRow(Icons.Rounded.EditNote, "手动录入", "输入题干和数学公式") { showAdd = false; editorId = "manual-${UUID.randomUUID()}" }
            }
        }
        if (showNewCollection) CreateCollectionDialog(onDismiss = { showNewCollection = false }) { model.createCollection(it); showNewCollection = false }
        if(showLibraryBackup) LibraryBackupDialog({ showLibraryBackup = false }, beginLibraryExport, beginLibraryImport)
        if(backupProgress != null) BackupProgressDialog(backupProgress!!, model::cancelBackup)
        else pendingBackup?.let { BackupImportDialog(it.summary, model::dismissBackupImport, model::restoreLibrary) }
        pendingExport?.let { request ->
            AlertDialog(onDismissRequest = { pendingExport = null }, title = { Text("还有 ${request.ordered.count { !it.reviewed }} 道题待校对") },
                text = { Text("请确认公式、数字和图形。继续导出将包含当前草稿。") },
                confirmButton = { TextButton(onClick = { pendingExport = null; generateDocument(request) }, modifier = Modifier.testTag("export-continue")) { Text("继续导出") } },
                dismissButton = { TextButton(onClick = { pendingExport = null; collectionId = request.collection.id }) { Text("返回校对") } })
        }
        if (addQuestionId != null) AlertDialog(onDismissRequest = { addQuestionId = null }, title = { Text("加入题集") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (collections.isEmpty()) Text("先在题集页面创建一个题集")
                collections.forEach { collection -> TextButton(onClick = { model.add(collection.id, addQuestionId!!); addQuestionId = null; model.message("已加入题集") }) { Text(collection.title) } }
            }
        }, confirmButton = { TextButton(onClick = { addQuestionId = null }) { Text("完成") } })
        exportFile?.let { file -> AlertDialog(onDismissRequest = { exportFile = null }, title = { Text("文档已生成") }, text = { Column { Text("${file.name}\n\n${if(file.extension == "docx") "首版 Word 的正文可编辑，公式以图片保留。" else "PDF 已保留题目排版与公式。"}"); if(file.extension == "pdf") TextButton(onClick = { previewFile = file; exportFile = null }) { Text("查看分页预览") } } },
            confirmButton = { TextButton(onClick = {
                val mime = if (file.extension == "pdf") "application/pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                saveDocument.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime).putExtra(Intent.EXTRA_TITLE, file.name))
            }) { Text("保存文件") } }, dismissButton = { TextButton(onClick = {
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                val mime = if(file.extension == "pdf") "application/pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).apply { clipData = ClipData.newRawUri("题集", uri) }.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "分享题集"))
            }) { Text("分享") } }) }
    }
}

@Composable
private fun GlassPanel(state: HazeState, modifier: Modifier, dark: Boolean, content: @Composable () -> Unit) {
    val tint = if (dark) Color(0xFF1B2435) else Color.White
    val background = MaterialTheme.colorScheme.background
    Box(modifier.clip(RoundedCornerShape(50.dp)).hazeEffect(state) {
        backgroundColor = background
        blurRadius = 12.dp
        tints = listOf(HazeTint(tint.copy(alpha = if(dark) .32f else .28f)))
        fallbackTint = HazeTint(tint.copy(alpha = if(dark) .48f else .40f))
        noiseFactor = .015f
    }.border(1.dp, Color.White.copy(alpha = if(dark) .10f else .45f), RoundedCornerShape(50.dp))) { content() }
}

@Composable
private fun SlidingNavigation(selected: Int, onSelect: (Int) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().padding(2.dp).selectableGroup()) {
        val cell = maxWidth / 3
        val position by animateDpAsState(cell * selected, spring(dampingRatio = .84f, stiffness = 420f), label = "navigation-slide")
        Box(Modifier.offset { IntOffset(position.roundToPx(), 0) }.width(cell).fillMaxHeight().clip(RoundedCornerShape(30.dp))
            .background(MaterialTheme.colorScheme.primary.copy(alpha = .10f)).testTag("navigation-indicator"))
        Row(Modifier.fillMaxSize()) {
            NavItem("题库", "library", Icons.Rounded.AutoStories, selected == 0, Modifier.weight(1f)) { onSelect(0) }
            NavItem("题集", "collections", Icons.Rounded.FolderOpen, selected == 1, Modifier.weight(1f)) { onSelect(1) }
            NavItem("我的", "profile", Icons.Rounded.PersonOutline, selected == 2, Modifier.weight(1f)) { onSelect(2) }
        }
    }
}

@Composable
private fun NavItem(label: String, id: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if(pressed) .95f else 1f, spring(dampingRatio = .78f, stiffness = 450f), label = "navigation-press")
    val tint by animateColorAsState(if(selected) MaterialTheme.colorScheme.primary else Muted, tween(180), label = "navigation-tint")
    Column(modifier.height(48.dp).scale(scale).clip(RoundedCornerShape(30.dp))
        .selectable(selected, interactionSource = interaction, indication = null, role = Role.Tab, onClick = onClick).testTag("nav-$id")
        .padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp))
        Text(label, fontSize = 10.sp, lineHeight = 13.sp, color = tint)
    }
}

@Composable
private fun LibraryScreen(questions: List<Question>, job: ImportJob?, busy: Boolean, onEdit: (Question) -> Unit, onAdd: () -> Unit,
    onExample: () -> Unit, onFavorite: (Question) -> Unit, onAddToCollection: (String) -> Unit, onRetry: (String) -> Unit, onBackup: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("全部") }
    var grade by rememberSaveable { mutableStateOf("所有年级") }
    val filtered = questions.filter { q ->
        (filter == "全部" || filter == "待校对" && !q.reviewed || filter == "已校对" && q.reviewed || filter == "收藏" && q.favorite || filter in KnowledgeCatalog.decode(q.knowledge)) &&
        (grade == "所有年级" || grade == q.grade) &&
        (search.isBlank() || listOf(q.title, q.body, q.latex, q.knowledge, q.grade).any { it.contains(search, true) })
    }
    LazyColumn(Modifier.testTag("library-list"), contentPadding = PaddingValues(start = 22.dp, end = 22.dp, top = 18.dp, bottom = 100.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(Blue), contentAlignment = Alignment.Center) { Text("√", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp) }; Spacer(Modifier.width(10.dp)); Text("Matheca", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
            Spacer(Modifier.weight(1f))
            FilledTonalButton(onClick = onBackup, modifier = Modifier.heightIn(min = 40.dp).testTag("library-backup-open"),
                shape = RoundedCornerShape(50.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
                Icon(Icons.Rounded.ImportExport, null, Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text("题库备份", fontSize = 12.sp)
            }
        } }
        item { Text("收录 · 整理 · 再练一次", color = Muted, fontSize = 14.sp) }
        item { Row(Modifier.fillMaxWidth().testTag("library-statistics").clip(RoundedCornerShape(20.dp)).background(Brush.linearGradient(listOf(Blue, Color(0xFF4D85EF)))).padding(horizontal = 12.dp, vertical = 12.dp)) {
            Stat("${questions.size}", "收录题目", "total", Modifier.weight(1f)); Stat("${questions.count { !it.reviewed }}", "待校对", "pending", Modifier.weight(1f)); Stat("${questions.count { it.favorite }}", "收藏", "favorite", Modifier.weight(1f))
        } }
        if (busy || job != null) item { Surface(shape = RoundedCornerShape(40.dp), color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if(busy || job?.status in listOf("queued", "processing")) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.CheckCircleOutline, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(8.dp)); Text(if(busy) "正在导入文件" else job!!.message, Modifier.weight(1f), fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if(job?.status in listOf("failed", "partial")) TextButton(onClick = { onRetry(job!!.id) }) { Text("重试") }
            }
        } }
        item { OutlinedTextField(value = search, onValueChange = { search = it }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(18.dp), placeholder = { Text("搜索题目、公式或知识点") }, leadingIcon = { Icon(Icons.Rounded.Search, null) }, singleLine = true, colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = .4f), unfocusedContainerColor = MaterialTheme.colorScheme.surface, focusedContainerColor = MaterialTheme.colorScheme.surface)) }
        item { LazyRow(Modifier.testTag("library-filter-list"), horizontalArrangement = Arrangement.spacedBy(8.dp)) { items(listOf("全部", "待校对", "已校对", "收藏") + questions.flatMap { KnowledgeCatalog.decode(it.knowledge) }.distinct()) { label -> AnimatedTag(label, filter == label, { filter = label }, Modifier.testTag("library-filter-$label"), showIndicator = false) } } }
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if(search.isBlank()) "我的题库" else "搜索结果", fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Spacer(Modifier.weight(1f)); var expanded by remember { mutableStateOf(false) }
            Box { TextButton(onClick = { expanded = true }, modifier = Modifier.testTag("library-grade-filter")) { Text(grade, fontSize = 12.sp); Icon(Icons.Rounded.ExpandMore, null, Modifier.size(16.dp)) }
                RoundedPopupMenu(expanded, { expanded = false }, Modifier.testTag("library-grade-menu"), width = 208.dp) {
                    (listOf("所有年级") + KnowledgeCatalog.grades).forEach { label ->
                        RoundedMenuItem(label, onClick = { grade = label; expanded = false }, selected = grade == label,
                            modifier = Modifier.testTag("library-grade-option-$label"))
                    }
                }
            }
        } }
        if (filtered.isEmpty()) item { EmptyCard(if(questions.isEmpty()) "开始收藏你的第一道好题" else "没有符合条件的题目", if(questions.isEmpty()) "拍照、相册或文件都能成为起点" else "试试其他关键词或筛选条件", "添加题目", onAdd)
            if(questions.isEmpty()) TextButton(onClick = onExample, modifier = Modifier.fillMaxWidth()) { Text("先用 3 道示例题体验") }
        }
        items(filtered, key = { it.id }) { q ->
            QuestionSummaryCard(q, "library", onClick = { onEdit(q) }, trailing = {
                LibraryQuestionMenu(q, onFavorite = { onFavorite(q) }, onAdd = { onAddToCollection(q.id) })
            }, extraLabels = buildList { if(q.example) add("示例"); if(q.favorite) add("已收藏") })
        }
        item { Text("识别结果待校对 · 保留原图与公式", color = Muted, fontSize = 11.sp, modifier = Modifier.fillMaxWidth()) }
    }
}

@Composable private fun Stat(value: String, label: String, id: String, modifier: Modifier) {
    Column(modifier.testTag("library-stat-$id"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(value, Modifier.fillMaxWidth().testTag("library-stat-$id-number"), fontSize = 24.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold,
            color = Color.White, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(label, Modifier.fillMaxWidth().testTag("library-stat-$id-label"), fontSize = 11.sp, lineHeight = 14.sp,
            color = Color.White.copy(alpha = .85f), textAlign = TextAlign.Center)
    }
}

@Composable
private fun LibraryQuestionMenu(question: Question, onFavorite: () -> Unit, onAdd: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.size(28.dp).testTag("library-menu-${question.id}")) {
            Icon(Icons.Rounded.MoreHoriz, "题目操作", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        RoundedPopupMenu(expanded, { expanded = false }, Modifier.testTag("library-action-menu-${question.id}")) {
            RoundedMenuItem(if(question.favorite) "取消收藏" else "收藏题目", icon = if(question.favorite) Icons.Rounded.Bookmark else Icons.Rounded.BookmarkBorder,
                onClick = { expanded = false; onFavorite() }, modifier = Modifier.testTag("library-favorite-${question.id}"))
            RoundedMenuDivider()
            RoundedMenuItem("加入题集", icon = Icons.Rounded.Add,
                onClick = { expanded = false; onAdd() }, modifier = Modifier.testTag("library-add-${question.id}"))
        }
    }
}

@Composable private fun EmptyCard(title: String, subtitle: String, action: String, onAction: () -> Unit) {
    Surface(shape = CardShape, color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Rounded.AutoStories, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(38.dp))
        Text(title, fontWeight = FontWeight.SemiBold); Text(subtitle, color = Muted, fontSize = 13.sp); Button(onClick = onAction) { Text(action) }
    } }
}

@Composable private fun ActionRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(vertical = 14.dp, horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(15.dp)).background(Blue.copy(alpha = .09f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) }
        Column(Modifier.weight(1f).padding(start = 14.dp)) { Text(title, fontWeight = FontWeight.SemiBold); Text(subtitle, color = Muted, fontSize = 12.sp) }
        Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
    }
}

@Composable
private fun CollectionsScreen(collections: List<QuestionCollection>, items: List<CollectionItem>, exportingId: String?, onOpen: (String) -> Unit,
    onCreate: () -> Unit, onDelete: (String) -> Unit, onExport: (QuestionCollection, Boolean) -> Unit) {
    var deleteId by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().testTag("collections-screen")) {
        Surface(Modifier.fillMaxWidth().testTag("collections-header"), color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onSurface) {
            Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 22.dp, top = 20.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("我的题集", Modifier.testTag("collections-title"), fontSize = 30.sp, fontWeight = FontWeight.Bold)
                    Text("把知识连起来，把好题留在一起", Modifier.testTag("collections-subtitle"),
                        color = Muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                CreateCollectionButton(onCreate)
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("collections-list"), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 100.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if(collections.isEmpty()) item { EmptyCard("给练习一个主题", "创建错题集、章节练习或复习试卷", "创建题集", onCreate) }
            items(collections, key = { it.id }) { collection -> Surface(onClick = { onOpen(collection.id) }, modifier = Modifier.testTag("collection-card-${collection.id}"), shape = CardShape, color = MaterialTheme.colorScheme.surface) {
                val count = items.count { it.collectionId == collection.id }
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.FolderOpen, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(32.dp))
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(collection.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text("$count 道题", Modifier.testTag("collection-description-${collection.id}"), fontSize = 12.sp, color = Muted)
                    }
                    CollectionExportMenu(collection.id, count > 0 && exportingId == null, exportingId == collection.id) { onExport(collection, it) }
                    Spacer(Modifier.width(6.dp))
                    CollectionActionButton("删除", "删除题集", Icons.Rounded.DeleteOutline,
                        Modifier.testTag("collection-delete-${collection.id}"), enabled = exportingId != collection.id) { deleteId = collection.id }
                }
            } }
        }
    }
    deleteId?.let { id ->
        collections.firstOrNull { it.id == id }?.let { collection ->
            DeleteCollectionDialog(collection.title, onDismiss = { deleteId = null }, onConfirm = { deleteId = null; onDelete(id) })
        }
    }
}

@Composable private fun CreateCollectionButton(onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val dark = colors.background.luminance() < .5f
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if(pressed) .95f else 1f, spring(dampingRatio = .76f, stiffness = 420f), label = "create-collection-press")
    val shape = RoundedCornerShape(50.dp)
    FilledTonalButton(onClick, modifier = Modifier.scale(scale).heightIn(min = 48.dp).widthIn(min = 88.dp)
        .border(1.dp, colors.primary.copy(alpha = .12f), shape).testTag("collections-create"), shape = shape,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp), interactionSource = interaction,
        colors = ButtonDefaults.filledTonalButtonColors(containerColor = colors.primary.copy(alpha = if(dark) .14f else .10f),
            contentColor = if(dark) colors.primary else Color(0xFF285DCF))) {
        Icon(Icons.Rounded.Add, "创建题集", Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text("创建", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun CollectionDetail(collection: QuestionCollection, ordered: List<Question>, all: List<Question>, exporting: Boolean, onBack: () -> Unit,
    onEdit: (Question) -> Unit, onAdd: (List<String>) -> Unit, onRemove: (String) -> Unit, onMove: (String, Int) -> Unit,
    onPaperChange: (PaperSettings) -> Unit, onExport: (Boolean, PaperSettings) -> Unit) {
    var choosing by rememberSaveable(collection.id) { mutableStateOf(false) }
    val buttonHaze = remember { HazeState() }
    val bottomInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    Box(Modifier.fillMaxSize().testTag("collection-screen")) {
        Column(Modifier.fillMaxSize()) {
            Surface(Modifier.fillMaxWidth().testTag("collection-header"), color = MaterialTheme.colorScheme.background,
                contentColor = MaterialTheme.colorScheme.onSurface) {
                PageHeader(collection.title, onBack, Modifier.padding(start = 22.dp, end = 22.dp, top = 12.dp, bottom = 8.dp))
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth().hazeSource(buttonHaze).testTag("collection-detail"),
                contentPadding = PaddingValues(22.dp, 12.dp, 22.dp, 92.dp + bottomInset), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                item { Text("${ordered.size} 道题 · 调整顺序后生成练习文档", color = Muted) }
                itemsIndexed(ordered, key = { _, q -> q.id }) { index, q ->
                    QuestionSummaryCard(q, "collection", onClick = { onEdit(q) }, trailing = {
                        CollectionQuestionMenu(q.id, index, ordered.size, onMove, onRemove)
                    })
                }
                item { PaperSettingsEditor(collection, exporting, ordered.isNotEmpty(), onPaperChange, onExport) }
            }
        }
        FloatingAddQuestionButton(buttonHaze, dark, Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 22.dp, bottom = 16.dp)) { choosing = true }
    }
    if(choosing) QuestionPicker(all, ordered.map { it.id }.toSet(), onDismiss = { choosing = false }, onConfirm = { ids -> onAdd(ids); choosing = false })
}

@Composable private fun CollectionQuestionMenu(questionId: String, index: Int, count: Int, onMove: (String, Int) -> Unit, onRemove: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.size(28.dp).testTag("collection-menu-$questionId")) {
            Icon(Icons.Rounded.MoreHoriz, "题目操作", Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        RoundedPopupMenu(expanded, { expanded = false }, Modifier.testTag("collection-action-menu-$questionId")) {
            RoundedMenuItem("上移题目", icon = Icons.Rounded.KeyboardArrowUp, enabled = index > 0,
                onClick = { expanded = false; onMove(questionId, -1) }, modifier = Modifier.testTag("collection-move-up-$questionId"))
            RoundedMenuItem("下移题目", icon = Icons.Rounded.KeyboardArrowDown, enabled = index < count - 1,
                onClick = { expanded = false; onMove(questionId, 1) }, modifier = Modifier.testTag("collection-move-down-$questionId"))
            RoundedMenuDivider()
            RoundedMenuItem("从题集移除", icon = Icons.Rounded.RemoveCircleOutline, destructive = true,
                onClick = { expanded = false; onRemove(questionId) }, modifier = Modifier.testTag("collection-remove-$questionId"))
        }
    }
}

@Composable private fun FloatingAddQuestionButton(state: HazeState, dark: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(modifier) {
        GlassActionSurface(state, dark, Modifier.height(52.dp).testTag("collection-add-floating"), RoundedCornerShape(50.dp), onClick) { foreground ->
            Row(Modifier.fillMaxHeight().padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Add, null, Modifier.size(22.dp), tint = foreground)
                Text("添加题目", fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = foreground)
            }
        }
    }
}

/** Captures only the separate content layer, so the glass never blurs itself. */
@Composable private fun GlassActionSurface(state: HazeState, dark: Boolean, modifier: Modifier, shape: Shape,
    onClick: () -> Unit, content: @Composable BoxScope.(Color) -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if(pressed) .94f else 1f, spring(dampingRatio = .78f, stiffness = 420f), label = "glass-action-press")
    val tint = Blue.copy(alpha = .96f)
    val foreground = Color.White
    val backdrop = MaterialTheme.colorScheme.background
    Box(modifier.scale(scale)
        .shadow(8.dp, shape, ambientColor = Blue.copy(alpha = .08f), spotColor = Blue.copy(alpha = .12f))
        .clip(shape).hazeEffect(state) {
            backgroundColor = backdrop
            blurRadius = 24.dp
            tints = listOf(HazeTint(tint))
            fallbackTint = HazeTint(tint)
            noiseFactor = .018f
        }
        .background(Brush.linearGradient(listOf(Color.White.copy(alpha = .01f), Color.Transparent)))
        .border(1.dp, Color.White.copy(alpha = if(dark) .22f else .18f), shape)
        .clickable(interactionSource = interaction, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center) { content(foreground) }
}

@Composable
private fun QuestionEditor(question: Question, dark: Boolean, solutionState: androidx.work.WorkInfo.State?, onGenerate: (Question) -> Unit, onCancel: () -> Unit,
    onBack: () -> Unit, onSave: (Question) -> Unit, onDraft: (Question) -> Unit, onDelete: () -> Unit, onAdd: (Question) -> Unit) {
    var title by rememberSaveable(question.id) { mutableStateOf(QuestionText.cleanTitle(question.title)) }
    var body by rememberSaveable(question.id) { mutableStateOf(QuestionText.clean(question.body)) }
    var latex by rememberSaveable(question.id) { mutableStateOf(question.latex) }
    var grade by rememberSaveable(question.id) { mutableStateOf(KnowledgeCatalog.grade(question.grade)) }
    var kind by rememberSaveable(question.id) { mutableStateOf(question.kind) }
    var knowledge by rememberSaveable(question.id) { mutableStateOf(KnowledgeCatalog.normalize(question.knowledge)) }
    var difficulty by rememberSaveable(question.id) { mutableStateOf(question.difficulty) }
    var confirmDelete by remember { mutableStateOf(false) }
    var showOriginal by remember { mutableStateOf(true) }
    var autoSolve by rememberSaveable(question.id) { mutableStateOf(question.autoSolve) }
    val draft = QuestionReview.edited(question, QuestionText.normalize(question.copy(title = title.ifBlank { "新题目" }, body = body, latex = latex, grade = grade, kind = kind, knowledge = knowledge, difficulty = difficulty, autoSolve = autoSolve)))
    val leave = { if(draft != question && (body.isNotBlank() || latex.isNotBlank())) onDraft(draft); onBack() }
    BackHandler(onBack = leave)
    LaunchedEffect(title, body, latex, grade, kind, knowledge, difficulty, autoSolve) {
        if(draft != question && (body.isNotBlank() || latex.isNotBlank())) { delay(650); onDraft(draft) }
    }
    Column(Modifier.fillMaxSize().imePadding().testTag("question-editor-screen")) {
        Surface(Modifier.fillMaxWidth().testTag("question-editor-header"), color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onSurface) {
            Column(Modifier.padding(start = 22.dp, end = 22.dp, top = 12.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                PageHeader(if(question.reviewed) "编辑题目" else "校对与录入", leave, Modifier.testTag("question-editor-title"))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        QuestionReviewBadge(draft.reviewed, Modifier.testTag("question-editor-review"))
                        Text(if(draft.reviewed) "修改题干或分类后需重新校对" else "确认后标记已校对",
                            fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    FilledTonalButton(onClick = { onSave(QuestionReview.confirmed(draft)) }, enabled = body.isNotBlank(),
                        modifier = Modifier.heightIn(min = 48.dp).testTag("question-editor-confirm"), shape = RoundedCornerShape(50.dp),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)) {
                        Text(if(draft.reviewed) "保存校对" else "确认校对", fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("question-editor"), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 52.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if(question.sourcePath.isNotBlank()) item { Surface(shape = CardShape, color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("原始来源", fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); TextButton(onClick = { showOriginal = !showOriginal }) { Text(if(showOriginal) "收起" else "展开") } }
                    if(showOriginal) AsyncImage(model = File(question.sourcePath), contentDescription = "原题图像，校对时保留公式与图形", modifier = Modifier.fillMaxWidth().heightIn(max = 400.dp))
                    Text(question.sourceLabel, fontSize = 11.sp, color = Muted)
                }
            } }
            item { Text("请对照原图校对识别结果与分类。你的修改会自动保存为草稿。", color = Muted, fontSize = 12.sp) }
            item { OutlinedTextField(title, { title = it }, label = { Text("题目标题") }, modifier = Modifier.fillMaxWidth().testTag("question-title-input"), shape = RoundedCornerShape(16.dp)) }
            item { OutlinedTextField(body, { body = it }, label = { Text("题干与子题") }, supportingText = { Text("多个小题各占一行，可用（1）（2）标记；公式用 \\(…\\) 或 \\[…\\] 写入题干。") }, modifier = Modifier.fillMaxWidth().testTag("question-body-input"), minLines = 5, shape = RoundedCornerShape(16.dp)) }
            if(body.isNotBlank()) item { Surface(shape = CardShape, color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("题目预览", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
                    RichMathText(MathContent.preview(draft), Modifier.fillMaxWidth().testTag("question-preview"), dark)
                }
            } }
            item { OutlinedTextField(latex, { latex = it }, label = { Text("独立公式 · LaTeX（可选）") }, supportingText = { Text("仅用于题干公式校对，不参与练习导出。需要导出的公式请写入题干。") }, modifier = Modifier.fillMaxWidth().testTag("question-formula-input"), shape = RoundedCornerShape(16.dp)) }
            item { Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("分数" to "\\frac{a}{b}", "根号" to "\\sqrt{x}", "平方" to "x^{2}").forEach { (label, value) -> OutlinedButton(onClick = { latex += value }) { Text(label) } }
            } }
            if(latex.isNotBlank()) item { Surface(Modifier.testTag("proofreading-formula-panel"), shape = CardShape, color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("公式校对预览 · 不参与导出", color = MaterialTheme.colorScheme.primary, fontSize = 12.sp)
                    RichMathText(MathContent.proofreadingFormula(latex), Modifier.fillMaxWidth().testTag("proofreading-formula-preview"), dark)
                }
            } }
            item { Text("分类建议 · 可手动调整", fontWeight = FontWeight.SemiBold); TextButton(onClick = { val suggestion = Classification.suggest(body); grade = suggestion.grade; kind = suggestion.kind; knowledge = suggestion.knowledge }) { Text("根据题干重新建议") } }
            item { ClassificationChoice("年级", grade, KnowledgeCatalog.grades, segmented = true) { grade = it } }
            item { ClassificationChoice("题型", kind, KnowledgeCatalog.kinds) { kind = it } }
            item { ClassificationChoice("难度", difficulty, KnowledgeCatalog.difficulties, segmented = true) { difficulty = it } }
            item { KnowledgeTags(knowledge) { knowledge = it } }
            item { SolutionPanel(draft, autoSolve, { autoSolve = it; if(!it) onCancel() }, solutionState, dark, onGenerate = { onGenerate(draft) }, onCancel = onCancel) }
            item { Button(onClick = { onSave(QuestionReview.confirmed(draft)) }, enabled = body.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(18.dp)) { Text("确认并保存题目") } }
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { TextButton(onClick = { onAdd(draft) }, enabled = body.isNotBlank()) { Text("加入题集") }; TextButton(onClick = { confirmDelete = true }) { Text("删除题目", color = MaterialTheme.colorScheme.error) } } }
        }
    }
    if(confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("删除这道题？") }, text = { Text("题目会从题库和相关题集中移除。") }, confirmButton = { TextButton(onClick = onDelete) { Text("删除") } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("取消") } })
}

@Composable private fun PageHeader(title: String, onBack: () -> Unit, modifier: Modifier = Modifier) { Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { IconButton(onClick = onBack) { Icon(Icons.Rounded.ArrowBack, "返回") }; Text(title, Modifier.weight(1f), fontSize = 24.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis) } }
