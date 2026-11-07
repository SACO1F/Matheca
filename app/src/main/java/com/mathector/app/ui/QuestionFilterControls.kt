package com.mathector.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mathector.app.data.*

/** The library and computer exchange use the same taxonomy, matching rules and selectors. */
@Stable
internal class QuestionFilterState {
    var grade by mutableStateOf<String?>(null)
    var kind by mutableStateOf<String?>(null)
    var knowledge by mutableStateOf<String?>(null)
    var difficulty by mutableStateOf<String?>(null)
    val active get() = grade != null || kind != null || knowledge != null || difficulty != null
    fun reset() { grade=null; kind=null; knowledge=null; difficulty=null }
    fun filter(query: String = "") = QuestionFilter(query=query,grade=grade,kind=kind,knowledge=knowledge,difficulty=difficulty)
    companion object {
        val Saver = androidx.compose.runtime.saveable.listSaver<QuestionFilterState, String>(
            save={listOf(it.grade.orEmpty(),it.kind.orEmpty(),it.knowledge.orEmpty(),it.difficulty.orEmpty())},
            restore={values -> QuestionFilterState().apply {grade=values[0].ifEmpty {null}; kind=values[1].ifEmpty {null}; knowledge=values[2].ifEmpty {null}; difficulty=values[3].ifEmpty {null} }}
        )
    }
}

@Composable internal fun rememberQuestionFilterState() = rememberSaveable(saver=QuestionFilterState.Saver) {QuestionFilterState()}

@Composable internal fun rememberQuestionKnowledgeGroups(questions: List<Question>, state: QuestionFilterState): List<GlideGroup> {
    val custom by KnowledgeCatalog.customPoints.collectAsStateWithLifecycle()
    val existing=remember(questions) {questions.flatMap {KnowledgeCatalog.decode(it.knowledge)}.toSet()}
    LaunchedEffect(existing) {if(state.knowledge != null && state.knowledge !in existing) state.knowledge=null}
    return remember(custom,existing) {KnowledgeCatalog.groups.map {(title,values)->GlideGroup(title,values.filter {it in existing})}.filter {it.options.isNotEmpty()} }
}

@Composable internal fun QuestionCategoryFilters(state: QuestionFilterState, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        PickerFilter("年级", "grade", state.grade, listOf<String?>(null) + KnowledgeCatalog.grades, MaterialTheme.colorScheme.primary, Modifier.weight(1f).testTag("glide-select-grade"), { "全部年级" }, { it }, enabled) {state.grade=it}
        PickerFilter("题型", "kind", state.kind, listOf<String?>(null) + KnowledgeCatalog.kinds, MaterialTheme.colorScheme.primary, Modifier.weight(1f).testTag("glide-select-kind"), { "全部题型" }, { it }, enabled) {state.kind=it}
        PickerFilter("难度", "difficulty", state.difficulty, listOf<String?>(null) + KnowledgeCatalog.difficulties + "待评估", LocalMathecaPalette.current.warning, Modifier.weight(1f).testTag("glide-select-difficulty"), { "全部难度" }, { it }, enabled) {state.difficulty=it}
    }
}

@Composable internal fun QuestionKnowledgeFilter(state: QuestionFilterState, groups: List<GlideGroup>, enabled: Boolean = true) {
    PickerFilter("知识点", "knowledge", state.knowledge, listOf<String?>(null) + groups.flatMap {it.options}, MaterialTheme.colorScheme.primary, Modifier.fillMaxWidth().testTag("glide-select-knowledge"), { "全部知识点" }, { it }, enabled && groups.isNotEmpty()) {state.knowledge=it}
}
