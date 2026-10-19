package com.mathector.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mathector.app.data.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun QuestionPicker(all: List<Question>, existingIds: Set<String>, onDismiss: () -> Unit, onConfirm: (List<String>) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var grade by rememberSaveable { mutableStateOf<String?>(null) }
    var knowledge by rememberSaveable { mutableStateOf<String?>(null) }
    var difficulty by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedIds by rememberSaveable { mutableStateOf(emptyList<String>()) }
    val available = remember(all, existingIds) { all.filter { it.id !in existingIds } }
    val custom by KnowledgeCatalog.customPoints.collectAsStateWithLifecycle()
    val filter = QuestionFilter(query, grade, knowledge, difficulty)
    val visible = remember(available, filter, custom) { available.filter(filter::matches) }
    val availableIds = remember(available) { available.map { it.id }.toSet() }
    val selected = selectedIds.filter { it in availableIds }
    val points = remember(available, custom) { available.flatMap { KnowledgeCatalog.decode(it.knowledge) }.toSet() }
    val knowledgeOptions = listOf<String?>(null) + KnowledgeCatalog.points.filter { it in points } +
        if(available.any { KnowledgeCatalog.decode(it.knowledge).isEmpty() }) listOf("") else emptyList()
    val dark = MaterialTheme.colorScheme.background.luminance() < .5f
    val gradeColor = MaterialTheme.colorScheme.primary
    val knowledgeColor = MaterialTheme.colorScheme.primary
    val difficultyColor = LocalMathecaPalette.current.warning
    val reset = { query = ""; grade = null; knowledge = null; difficulty = null }
    val windowHeight = LocalWindowInfo.current.containerSize.height
    val viewport = with(LocalDensity.current) { windowHeight.toDp() } * .88f
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val latestDismiss by rememberUpdatedState(onDismiss)
    val latestConfirm by rememberUpdatedState(onConfirm)
    var closing by remember { mutableStateOf(false) }
    val hideAndThen: (() -> Unit) -> Unit = { after ->
        if(!closing) {
            closing = true
            focus.clearFocus()
            keyboard?.hide()
            scope.launch {
                try { sheetState.hide(); if(!sheetState.isVisible) after() }
                finally { closing = false }
            }
        }
    }
    ModalBottomSheet(onDismissRequest = { latestDismiss() }, sheetState = sheetState,
        sheetGesturesEnabled = false, dragHandle = null, containerColor = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().height(viewport).imePadding().padding(horizontal = 20.dp).padding(top = 16.dp, bottom = 12.dp).testTag("question-picker"),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("从题库选择", fontSize = 23.sp, fontWeight = FontWeight.Bold)
                    Text("按分类找题，选好后统一添加", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                }
                IconButton(onClick = { hideAndThen { latestDismiss() } }, enabled = !closing, modifier = Modifier.testTag("picker-close")) { Icon(Icons.Rounded.Close, "关闭选题") }
            }
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("picker-search"), singleLine = true,
                placeholder = { Text("搜索题目、公式或知识点", fontSize = 13.sp) }, leadingIcon = { Icon(Icons.Rounded.Search, null) }, shape = RoundedCornerShape(15.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PickerFilter("年级", "grade", grade, listOf<String?>(null) + KnowledgeCatalog.grades + "", gradeColor, Modifier.weight(1f),
                    { it ?: "全部年级" }, { it.ifBlank { "未设置年级" } }) { grade = it }
                PickerFilter("知识点", "knowledge", knowledge, knowledgeOptions, knowledgeColor, Modifier.weight(1f),
                    { it ?: "全部知识点" }, { it.ifBlank { "未标注知识点" } }) { knowledge = it }
                PickerFilter("难度", "difficulty", difficulty, listOf<String?>(null) + KnowledgeCatalog.difficulties + "待评估", difficultyColor, Modifier.weight(1f),
                    { it ?: "全部难度" }, { it }) { difficulty = it }
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${visible.size} 道可选", Modifier.weight(1f).testTag("picker-results"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = reset, enabled = filter.active, modifier = Modifier.testTag("picker-reset")) { Text("重置筛选") }
            }
            LazyColumn(Modifier.weight(1f).testTag("picker-list"), overscrollEffect = null, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 10.dp)) {
                if(visible.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Rounded.SearchOff, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(when { all.isEmpty() -> "题库暂无题目"; available.isEmpty() -> "题库中的题目均已加入此题集"; else -> "没有符合筛选条件的题目" }, fontSize = 14.sp)
                        if(available.isNotEmpty()) Text("试试减少筛选条件或更换关键词", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(visible, key = { it.id }) { question ->
                    QuestionSummaryCard(question, "picker", selected = question.id in selected, onClick = {
                        selectedIds = if(question.id in selectedIds) selectedIds - question.id else selectedIds + question.id
                    })
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("已选 ${selected.size} 道", Modifier.testTag("picker-selected-count"), fontWeight = FontWeight.SemiBold)
                    Text("切换筛选会保留已选题目", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { selectedIds = emptyList() }, enabled = selected.isNotEmpty(), modifier = Modifier.testTag("picker-clear-selection")) { Text("清空") }
                Button(onClick = { hideAndThen { latestConfirm(selected) } }, enabled = selected.isNotEmpty() && !closing, modifier = Modifier.testTag("picker-confirm")) { Text("添加 ${selected.size} 道题") }
            }
        }
    }
}

@Composable private fun PickerFilter(title: String, id: String, value: String?, options: List<String?>, tint: Color, modifier: Modifier,
    allLabel: (String?) -> String, valueLabel: (String) -> String, onSelect: (String?) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = value?.let(valueLabel) ?: allLabel(null)
    val windowWidth = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() }
    val menuWidth = minOf(if(id == "knowledge") 280.dp else 208.dp, (windowWidth - 40.dp).coerceAtLeast(0.dp))
    BoxWithConstraints(modifier) {
        Surface(onClick = { expanded = true }, Modifier.fillMaxWidth().testTag("picker-filter-$id"), shape = RoundedCornerShape(15.dp), color = tint.copy(alpha = .09f)) {
            Row(Modifier.padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, fontSize = 11.sp, color = tint)
                    Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(Icons.Rounded.ExpandMore, null, Modifier.size(16.dp), tint = tint)
            }
        }
        val menuOffset = if(id == "knowledge") DpOffset((maxWidth - menuWidth) / 2, 0.dp) else DpOffset.Zero
        RoundedPopupMenu(expanded, { expanded = false }, Modifier.testTag("picker-menu-$id"), width = menuWidth, offset = menuOffset) {
            options.forEachIndexed { index, option ->
                RoundedMenuItem(option?.let(valueLabel) ?: allLabel(null),
                    onClick = { onSelect(option); expanded = false }, selected = option == value, selectionColor = tint,
                    modifier = Modifier.testTag("picker-option-$id-${option ?: "all"}"))
                if(index == 0 && options.size > 1) RoundedMenuDivider()
            }
        }
    }
}
