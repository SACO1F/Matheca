package com.mathector.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** 一组可选值；[title] 为空时不渲染分组标题。 */
internal data class GlideGroup(val title: String, val options: List<String>)

private sealed interface GlideRow {
    data class Header(val title: String) : GlideRow
    data class Option(val value: String) : GlideRow
}

/** Minimum heights; actual rows grow with font scale and wrapped labels. */
private val HeaderHeight = 40.dp
private val OptionHeight = 48.dp

/**
 * glide-select 风格的下拉选择器：药丸触发器 + 原生弹出菜单 + 弹簧滑动高亮。
 * [value] 为 null 表示未选择，触发器显示 [label]。
 */
@Composable
internal fun GlideSelect(
    id: String,
    label: String,
    value: String?,
    groups: List<GlideGroup>,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary,
    menuWidth: Dp = 208.dp,
    enabled: Boolean = true,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val ink = if(enabled) tint else MaterialTheme.colorScheme.onSurfaceVariant
    val rows = remember(groups) {
        groups.flatMap { group -> (if (group.title.isBlank()) emptyList() else listOf(GlideRow.Header(group.title))) + group.options.map(GlideRow::Option) }
    }
    val density = LocalDensity.current
    val bounds = remember(rows) { mutableStateMapOf<Int, Pair<Dp,Dp>>() }
    val selectedIndex = rows.indexOfFirst { it is GlideRow.Option && it.value == value }
    var pressedIndex by remember { mutableStateOf<Int?>(null) }
    val highlightIndex = pressedIndex ?: selectedIndex
    val highlightBounds = bounds[highlightIndex]
    val highlight by animateDpAsState(highlightBounds?.first ?: 0.dp,
        spring(dampingRatio = .82f, stiffness = 460f), label = "glide-highlight-$id")
    val highlightHeight by animateDpAsState(highlightBounds?.second ?: OptionHeight,
        spring(dampingRatio = .82f, stiffness = 460f), label = "glide-height-$id")
    val chevron by animateFloatAsState(if (expanded) 180f else 0f, spring(dampingRatio = .78f, stiffness = 440f), label = "glide-chevron-$id")
    LaunchedEffect(expanded) { if (expanded) pressedIndex = null }

    Box(modifier) {
        Surface(onClick = { expanded = true }, Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("glide-select-$id"), enabled=enabled,
            shape = RoundedCornerShape(50.dp), color = ink.copy(alpha = .09f), contentColor = ink) {
            Row(Modifier.padding(start = 12.dp, end = 8.dp, top = 9.dp, bottom = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                AnimatedGlideLabel(value, label, ink, Modifier.weight(1f))
                Icon(Icons.Rounded.ExpandMore, "展开$label", Modifier.size(16.dp).rotate(chevron), tint = ink)
            }
        }
        RoundedPopupMenu(expanded, { expanded = false }, Modifier.testTag("glide-menu-$id"), width = menuWidth, offset = DpOffset.Zero) {
            Box(Modifier.fillMaxWidth()) {
                if(highlightBounds != null) Box(Modifier.offset(y = highlight).padding(horizontal = 6.dp).fillMaxWidth().height(highlightHeight)
                    .clip(RoundedCornerShape(15.dp)).background(tint.copy(alpha = .10f)).testTag("glide-highlight-$id"))
                Column {
                    rows.forEachIndexed { index, row ->
                        val measured = Modifier.onGloballyPositioned { coordinates ->
                            bounds[index] = with(density) {coordinates.positionInParent().y.toDp() to coordinates.size.height.toDp()}
                        }
                        when (row) {
                            is GlideRow.Header -> Box(measured.fillMaxWidth().heightIn(min=HeaderHeight).padding(start=20.dp,end=20.dp,top=12.dp,bottom=6.dp)
                                .semantics {heading()}.testTag("glide-header-$id-${row.title}"),contentAlignment=Alignment.CenterStart) {
                                Text(row.title,fontSize=15.sp,lineHeight=21.sp,fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.onSurface)
                            }
                            is GlideRow.Option -> GlideOption(id, row.value, row.value == value, tint, measured.heightIn(min=OptionHeight),
                                grouped=groups.any {it.title.isNotBlank()},
                                onPress = { pressedIndex = index },
                                onRelease = { if (pressedIndex == index) pressedIndex = null }) {
                                onSelect(row.value); expanded = false
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AnimatedGlideLabel(value: String?, label: String, tint: Color, modifier: Modifier) {
    AnimatedContent(value, modifier = modifier, label = "glide-label") { selected ->
        Text(selected ?: label, fontSize = 13.sp, fontWeight = if (selected == null) FontWeight.Normal else FontWeight.SemiBold,
            color = if (selected == null) MaterialTheme.colorScheme.onSurfaceVariant else tint,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun GlideOption(id: String, value: String, selected: Boolean, tint: Color, modifier: Modifier,
    grouped: Boolean,
    onPress: () -> Unit, onRelease: () -> Unit, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    LaunchedEffect(pressed) { if (pressed) onPress() else onRelease() }
    Row(modifier.fillMaxWidth().padding(horizontal = 6.dp).clip(RoundedCornerShape(15.dp))
        .selectable(selected, role = Role.RadioButton, interactionSource = interaction, indication = null, onClick = onClick)
        .testTag("glide-option-$id-$value").padding(start=if(grouped) 26.dp else 14.dp,end=14.dp,top=10.dp,bottom=10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(value, Modifier.weight(1f), fontSize = 14.sp, lineHeight=20.sp,fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) tint else MaterialTheme.colorScheme.onSurface)
        if (selected) Icon(Icons.Rounded.Check, null, Modifier.size(20.dp), tint = tint)
    }
}
