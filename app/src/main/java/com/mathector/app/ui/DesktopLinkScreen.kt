package com.mathector.app.ui

import android.Manifest
import androidx.compose.animation.*
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import android.os.Build
import android.content.pm.PackageManager
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mathector.app.AppViewModel
import kotlinx.coroutines.delay
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun DesktopLinkScreen(model: AppViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    var pendingAddress by remember { mutableStateOf("") }
    val localPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if(granted) model.desktopConnect(pendingAddress) else model.message("需要局域网／附近设备权限才能连接电脑，可稍后重试") }
    val connectToComputer: (String) -> Unit = { link ->
        if(Build.VERSION.SDK_INT >= 37 && ContextCompat.checkSelfPermission(context, "android.permission.ACCESS_LOCAL_NETWORK") != PackageManager.PERMISSION_GRANTED) { pendingAddress = link; localPermission.launch("android.permission.ACCESS_LOCAL_NETWORK") } else model.desktopConnect(link)
    }
    val notice by model.notice.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(notice) { notice?.let { snackbar.showSnackbar(it); model.clearNotice() } }
    val queue by model.desktopLink.queue.collectAsStateWithLifecycle()
    val savedDesktops by model.desktopLink.savedDesktops.collectAsStateWithLifecycle()
    val state by model.desktopLink.state.collectAsStateWithLifecycle()
    val progress by model.desktopLink.progress.collectAsStateWithLifecycle()
    val busy by model.desktopBusy.collectAsStateWithLifecycle()
    val error by model.desktopError.collectAsStateWithLifecycle()
    val questions by model.questions.collectAsStateWithLifecycle()
    val collections by model.collections.collectAsStateWithLifecycle()
    val collectionItems by model.items.collectAsStateWithLifecycle()
    val assessment by model.desktopAssessment.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var address by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var camera by remember { mutableStateOf(false) }
    var selectedQ by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val pageStates = rememberSaveableStateHolder()
    val questionFilters = rememberQuestionFilterState()
    val knowledgeGroups = rememberQuestionKnowledgeGroups(questions,questionFilters)
    val filteredQuestions = questions.filter(questionFilters.filter()::matches)
    var selectedC by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var changedOnly by rememberSaveable { mutableStateOf(false) }
    val exportZip = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri -> uri?.let { model.desktopExportSelection(it, selectedQ.toSet(), selectedC.toSet()) } }
    var policy by rememberSaveable { mutableStateOf("keep") }
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(20)) { model.desktopPhotos(it) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if(granted) scanning = true else model.message("相机权限未开启，可粘贴连接地址") }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if(granted) camera = true else model.message("相机权限未开启，可从相册选图") }
    LaunchedEffect(state != null) { while(state != null) { delay(3000); model.desktopPoll() } }
    BackHandler { if(scanning) scanning = false else if(camera) camera = false else onBack() }
    if(scanning) { DesktopQrScanner(onClose = { scanning = false }, onResult = { scanning = false; connectToComputer(it) }, onError = model::message); return }
    if(camera) { CameraScreen(onClose = { camera = false }, onCaptured = { camera = false; model.desktopPhotos(listOf(it)) }, onError = model::message); return }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = { TopAppBar(title = { Text("连接电脑",fontSize=24.sp,fontWeight=FontWeight.Bold) }, colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.background), navigationIcon = { IconButton(onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "返回") } }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            DesktopLinkTabs(tab) { tab=it }
            if(error != null) Text(error!!, Modifier.padding(16.dp).testTag("desktop-link-error"), color = MaterialTheme.colorScheme.error)
            if(busy) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text(progress.ifBlank { "正在处理…" }, Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall) }
            DesktopLinkPages(tab,Modifier.weight(1f).fillMaxWidth()) { selectedTab -> pageStates.SaveableStateProvider("link-$selectedTab") { Column(Modifier.fillMaxSize()) {
            LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("desktop-link-list"), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if(selectedTab == 0) {
                    item {
                        Text("手机先收题，连接后再发送", style = MaterialTheme.typography.titleLarge)
                        Text("照片与已选资料会保存在本机待传队列。电脑未开启时也可添加；发送不会自动开始识别。", style = MaterialTheme.typography.bodyMedium)
                    }
                    item { DesktopLinkPanel {
                        if(state == null) {
                            Button(onClick = { permission.launch(Manifest.permission.CAMERA) }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("desktop-scan")) { Text("扫码连接电脑") }
                            OutlinedTextField(address, { address = it }, label = { Text("或粘贴电脑的完整连接地址") }, shape=RoundedCornerShape(14.dp), singleLine = true, modifier = Modifier.fillMaxWidth().testTag("desktop-address"))
                            OutlinedButton(onClick = { connectToComputer(address) }, enabled = !busy && address.isNotBlank(), modifier = Modifier.testTag("desktop-connect")) { Text("连接") }
                        } else {
                            Text(if(state!!.optBoolean("approved")) "已获电脑允许" else "请在电脑允许连接 · 核对码 ${state!!.optString("code")}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("desktop-connection"))
                            Text("同一局域网连接，15 分钟有效。断开不会删除本机待传内容。", style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { model.desktopPoll(true) }, enabled = !busy) { Text("检查连接") }
                                TextButton(onClick = { model.desktopLink.disconnect() }, enabled = !busy) { Text("断开") }
                            }
                        }
                    } }
                    if(state?.optBoolean("approved")==true) item {
                        OutlinedButton(onClick = { model.desktopRemember() }, enabled = !busy && savedDesktops.none { it.id==state?.optString("serverId") }, modifier = Modifier.fillMaxWidth().testTag("desktop-remember")) { Text(if(savedDesktops.any { it.id==state?.optString("serverId") }) "已记住这台电脑" else "记住这台电脑") }
                    }
                    if(savedDesktops.isNotEmpty()) item { Text("已配对电脑", style=MaterialTheme.typography.titleMedium); Text("先在电脑开启手机联动。地址变化或配对被移除时，请重新扫码。",style=MaterialTheme.typography.bodySmall) }
                    items(savedDesktops,key={ "saved-"+it.id }) { saved -> DesktopLinkPanel {
                        Text("电脑 · ${saved.id.takeLast(6).uppercase()}",style=MaterialTheme.typography.titleSmall)
                        Text(saved.base,style=MaterialTheme.typography.bodySmall)
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                            OutlinedButton(onClick={ connectToComputer(saved.base+"/#pair="+saved.credential) },enabled=!busy && state==null,modifier=Modifier.testTag("desktop-reconnect")) { Text("再次连接") }
                            TextButton(onClick={model.desktopForget(saved.id)},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)) { Text("移除本机记录") }
                        }
                    } }
                    item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { cameraPermission.launch(Manifest.permission.CAMERA) }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("拍照待传") }
                        OutlinedButton(onClick = { photoPicker.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("相册待传") }
                    } }
                    item { Button(onClick = model::desktopSend, enabled = !busy && state?.optBoolean("approved") == true && queue.any { it.status != "sent" }, modifier = Modifier.fillMaxWidth().testTag("desktop-send")) { Text("发送待传内容（${queue.count { it.status != "sent" }}）") } }
                    if(queue.isEmpty()) item { Text("暂无待传内容。可以先拍照，或去“选择资料”添加已有题目与题集。") }
                    items(queue, key = { it.id }) { item ->
                        Surface(color=MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(24.dp)) { Column(Modifier.fillMaxWidth().padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                            model.desktopLink.previewFile(item.id)?.let { photo ->
                                var ready by remember(item.id) { mutableStateOf(false) }
                                var failed by remember(item.id) { mutableStateOf(false) }
                                coil.compose.AsyncImage(model = photo, contentDescription = "待传照片预览", modifier = Modifier.fillMaxWidth().heightIn(max = 180.dp).testTag(if(ready) "desktop-photo-ready" else "desktop-photo-loading"), onSuccess = { ready = true }, onError = { failed = true })
                                if(failed) Text("预览暂不可用，原图仍可发送", style = MaterialTheme.typography.bodySmall)
                            }
                            Text(item.name, style = MaterialTheme.typography.titleSmall)
                            Text(if(item.status == "sent") "已送达电脑 · 可手动清理" else if(item.status == "error") "发送失败：${item.error}" else "保存在本机 · 待发送", style = MaterialTheme.typography.bodySmall)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { model.desktopMove(item.id, -1) }, enabled = !busy && queue.firstOrNull()?.id != item.id) { Text("上移") }
                                TextButton(onClick = { model.desktopMove(item.id, 1) }, enabled = !busy && queue.lastOrNull()?.id != item.id) { Text("下移") }
                                TextButton(onClick = { model.desktopRemove(item.id) }, enabled = !busy) { Text(if(item.status == "sent") "清理" else "移除") }
                            }
                        } }
                    }
                }
                if(selectedTab == 1) {
                    item { Text("按桌面题库格式发送", style = MaterialTheme.typography.titleLarge); Text("题集会包含关联题目、顺序与排版设置；原图、插图和已有解答一起打包，不含接口密钥。", style = MaterialTheme.typography.bodyMedium) }
                    item {
                        Row(Modifier.fillMaxWidth().heightIn(min=48.dp).toggleable(value=changedOnly,enabled=!busy,role=Role.Checkbox,onValueChange={changedOnly=it}).semantics(mergeDescendants=true) {},verticalAlignment=Alignment.CenterVertically) { Checkbox(changedOnly,onCheckedChange=null,enabled=!busy); Text("仅加入与电脑不同的资料") }
                        Text(if(changedOnly) "需先连接电脑。相同内容跳过，冲突仍需接收确认；题集结构变化时包含关联题目，不传播删除。" else "全部所选资料加入本机队列，可离线保留。",style=MaterialTheme.typography.bodySmall)
                    }
                    item { Text("题集", style = MaterialTheme.typography.titleMedium) }
                    if(collections.isEmpty()) item { Text("暂无题集，可先在“题集”中创建。",color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall) }
                    items(collections, key = { "c-" + it.id }) { c -> CollectionSummaryCard(c,collectionItems.count { it.collectionId==c.id },selected=c.id in selectedC,enabled=!busy,
                        onClick={selectedC=if(c.id in selectedC) selectedC-c.id else selectedC+c.id},modifier=Modifier.testTag("desktop-select-c-${c.id}")) }
                    item { Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                        Text("题目 · ${filteredQuestions.size} 道",style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f).testTag("desktop-filter-count"))
                        TextButton(onClick=questionFilters::reset,enabled=!busy && questionFilters.active,modifier=Modifier.testTag("desktop-filter-reset")) {Text("重置")}
                    } }
                    item {QuestionCategoryFilters(questionFilters,enabled=!busy)}
                    item {QuestionKnowledgeFilter(questionFilters,knowledgeGroups,enabled=!busy)}
                    if(filteredQuestions.isEmpty()) item { Text(if(questions.isEmpty()) "暂无题目，可先在题库中添加。" else "没有符合条件的题目，试试调整或重置筛选。",modifier=Modifier.testTag("desktop-filter-empty"),color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall) }
                    items(filteredQuestions, key = { "q-" + it.id }) { q -> QuestionSummaryCard(q,"desktop",selected=q.id in selectedQ,enabled=!busy,
                        onClick={selectedQ=if(q.id in selectedQ) selectedQ-q.id else selectedQ+q.id},modifier=Modifier.testTag("desktop-select-q-${q.id}")) }
                }
                if(selectedTab == 2) {
                    item { Text("电脑发来的题库", style = MaterialTheme.typography.titleLarge); Text("电脑在“手机联动 → 题库交换”选择题目或题集发送。下载校验后先预览，再决定如何接收。", style = MaterialTheme.typography.bodyMedium) }
                    val transfers = state?.optJSONArray("transfers")
                    val libraries = if(transfers == null) emptyList() else List(transfers.length()) { transfers.getJSONObject(it) }.filter { it.optString("name").endsWith(".zip") }
                    if(libraries.isEmpty()) item { Text("暂无题库资料，请先连接电脑并发送。") }
                    items(libraries, key = { it.getString("id") }) { file -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(file.getString("name"), style = MaterialTheme.typography.titleSmall)
                        Button(onClick = { model.desktopDownload(file.getString("id"), file.getLong("size")) }, enabled = !busy) { Text("下载并预览") }
                    } }
                }
            }
            if(selectedTab==1) Surface(color=MaterialTheme.colorScheme.surface) { Column(Modifier.fillMaxWidth().padding(horizontal=22.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalArrangement=Arrangement.spacedBy(2.dp)) {
                    Text("已选 ${selectedQ.size} 道题 · ${selectedC.size} 个题集",fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick={exportZip.launch("Matheca桌面交换-${System.currentTimeMillis()}.zip")},enabled=!busy && (selectedQ.isNotEmpty() || selectedC.isNotEmpty()),modifier=Modifier.testTag("desktop-export-zip")) { Text("导出桌面交换 ZIP",fontSize=12.sp) }
                }
                Button(onClick={model.desktopQueueSelection(selectedQ.toSet(),selectedC.toSet(),changedOnly)},enabled=!busy && (selectedQ.isNotEmpty() || selectedC.isNotEmpty()) && (!changedOnly || state?.optBoolean("approved")==true),modifier=Modifier.fillMaxWidth().testTag("desktop-queue-selection")) { Text("加入待传队列") }
            } } }
            } }
        }
    }
    assessment?.let { preview -> AlertDialog(onDismissRequest = { model.desktopDismiss() }, title = { Text("接收电脑资料") },
        text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("新增 ${preview.added} · 重复 ${preview.repeated} · 冲突 ${preview.conflicts}")
            Text("同编号但内容不同会列为冲突；此阶段不自动判断哪一端更新，也不传播删除。", style = MaterialTheme.typography.bodySmall)
            Column(Modifier.selectableGroup()) {
                listOf("keep" to "保留本机版本", "replace" to "使用收到的版本", "copy" to "冲突另存为新题／题集").forEach { (value, label) ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = policy == value, enabled = !busy, role = Role.RadioButton, onClick = { policy = value }).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(policy == value, onClick = null, enabled = !busy); Text(label)
                    }
                }
            }
            preview.details.take(100).forEach { Text("${it.title} · ${when(it.status) { "new" -> "新增"; "same" -> "重复"; else -> "冲突" }}", style = MaterialTheme.typography.bodySmall) }
        } }, confirmButton = { TextButton(onClick = { model.desktopRestore(policy) }, enabled = !busy, modifier = Modifier.testTag("desktop-restore")) { Text("确认接收") } }, dismissButton = { TextButton(onClick = { model.desktopDismiss() }, enabled = !busy) { Text("取消") } }) }
}
