package com.mathector.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

@Composable
private fun overlayColor(): Color {
    val colors = MaterialTheme.colorScheme
    return if (colors.background.luminance() < .5f) Color.White.copy(alpha = .035f).compositeOver(colors.surface) else colors.surface
}

/** Keeps native popup placement, dismissal and opening/closing animations. */
@Composable
internal fun RoundedPopupMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    width: Dp = 224.dp,
    offset: DpOffset = DpOffset.Zero,
    content: @Composable ColumnScope.() -> Unit
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = modifier.width(width).heightIn(max = 360.dp),
        offset = offset,
        shape = RoundedCornerShape(24.dp),
        containerColor = LocalMathecaPalette.current.menu,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        border = null,
        content = content
    )
}

@Composable
internal fun RoundedMenuItem(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    selected: Boolean? = null,
    destructive: Boolean = false,
    selectionColor: Color? = null
) {
    val colors = MaterialTheme.colorScheme
    val selectedTint = selectionColor ?: colors.primary
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .98f else 1f, spring(dampingRatio = .8f, stiffness = 500f), label = "menu-press")
    val background by animateColorAsState(
        when { selected == true -> selectedTint.copy(alpha = .10f); pressed -> colors.onSurface.copy(alpha = .06f); else -> Color.Transparent },
        tween(120), label = "menu-highlight"
    )
    val tint = when { !enabled -> colors.onSurface.copy(alpha = .35f); destructive -> colors.error; selected == true -> selectedTint; else -> colors.onSurface }
    val action = if (selected != null) Modifier.selectable(selected, enabled = enabled, role = Role.RadioButton,
        interactionSource = interaction, indication = null, onClick = onClick)
    else Modifier.clickable(enabled = enabled, role = Role.Button, interactionSource = interaction, indication = null, onClick = onClick)
    Row(modifier.fillMaxWidth().padding(horizontal = 6.dp).scale(scale).clip(RoundedCornerShape(15.dp))
        .background(background).then(action).heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(1f), fontSize = 15.sp, fontWeight = if (selected == true) FontWeight.SemiBold else FontWeight.Normal, color = tint)
        if (selected == true) Icon(Icons.Rounded.Check, null, Modifier.size(20.dp), tint = tint)
        else if (icon != null) Icon(icon, null, Modifier.size(20.dp), tint = tint)
    }
}

@Composable
internal fun RoundedMenuDivider() {
    HorizontalDivider(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), thickness = .5.dp,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))
}

@Composable
internal fun DeleteCollectionDialog(name: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val divider = colors.onSurface.copy(alpha = .08f)
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
            Surface(Modifier.widthIn(max = 320.dp).fillMaxWidth().testTag("collection-delete-dialog"),
                shape = RoundedCornerShape(28.dp), color = overlayColor(), contentColor = colors.onSurface,
                tonalElevation = 0.dp, shadowElevation = 0.dp) {
                Column {
                    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("删除这个题集？", fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                        Text(name, Modifier.testTag("collection-delete-name"), fontSize = 15.sp,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center, maxLines = 3,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        Text("题库中的题目会保留。", fontSize = 13.sp, color = colors.onSurface.copy(alpha = .65f),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                    HorizontalDivider(thickness = .5.dp, color = divider)
                    Row(Modifier.fillMaxWidth().height(52.dp)) {
                        TextButton(onClick = onDismiss, modifier = Modifier.weight(1f).fillMaxHeight().testTag("collection-delete-cancel"),
                            shape = RectangleShape, colors = ButtonDefaults.textButtonColors(contentColor = colors.primary)) {
                            Text("取消", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                        VerticalDivider(thickness = .5.dp, color = divider)
                        TextButton(onClick = onConfirm, modifier = Modifier.weight(1f).fillMaxHeight().testTag("collection-delete-confirm"),
                            shape = RectangleShape, colors = ButtonDefaults.textButtonColors(contentColor = colors.error)) {
                            Text("删除", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun CreateCollectionDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var focused by remember { mutableStateOf(false) }
    val colors = MaterialTheme.colorScheme
    val confirm = { if (name.isNotBlank()) onConfirm(name.trim()) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxWidth().padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
            Surface(Modifier.widthIn(max = 360.dp).fillMaxWidth().testTag("create-collection-dialog"),
                shape = RoundedCornerShape(30.dp), color = overlayColor(), contentColor = colors.onSurface, tonalElevation = 0.dp, shadowElevation = 16.dp,
                border = BorderStroke(1.dp, colors.onSurface.copy(alpha = .07f))) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(56.dp).clip(RoundedCornerShape(18.dp)).background(colors.primary.copy(alpha = .10f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.CreateNewFolder, null, Modifier.size(28.dp), tint = colors.primary)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("创建题集", fontSize = 23.sp, fontWeight = FontWeight.SemiBold)
                        Text("给错题、章节练习或复习试卷起个名字", fontSize = 13.sp, color = colors.onSurface.copy(alpha = .60f))
                    }
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("题集名称", fontSize = 13.sp, color = colors.onSurface.copy(alpha = .65f))
                        TextField(name, { name = it }, Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }
                            .border(1.dp, if (focused) colors.primary.copy(alpha = .50f) else colors.onSurface.copy(alpha = .06f), RoundedCornerShape(16.dp))
                            .testTag("collection-name"),
                            placeholder = { Text("例如：函数与导数复习", fontSize = 14.sp) }, singleLine = true, shape = RoundedCornerShape(16.dp),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { confirm() }),
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = colors.onSurface.copy(alpha = .04f), unfocusedContainerColor = colors.onSurface.copy(alpha = .04f),
                                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
                                focusedPlaceholderColor = colors.onSurface.copy(alpha = .40f), unfocusedPlaceholderColor = colors.onSurface.copy(alpha = .40f)))
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(onClick = onDismiss, modifier = Modifier.weight(1f).height(48.dp).testTag("create-collection-cancel"),
                            shape = RoundedCornerShape(16.dp), colors = ButtonDefaults.buttonColors(containerColor = colors.onSurface.copy(alpha = .06f), contentColor = colors.onSurface)) {
                            Text("取消", fontWeight = FontWeight.Medium)
                        }
                        Button(onClick = confirm, enabled = name.isNotBlank(), modifier = Modifier.weight(1f).height(48.dp).testTag("create-collection-confirm"), shape = RoundedCornerShape(16.dp)) {
                            Text("创建", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}
