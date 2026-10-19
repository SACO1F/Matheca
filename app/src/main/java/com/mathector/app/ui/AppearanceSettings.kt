package com.mathector.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mathector.app.data.AccentTheme
import com.mathector.app.data.AppSettings
import com.mathector.app.data.ThemeMode

@Composable internal fun AppearanceSettings(settings: AppSettings, onMode: (ThemeMode) -> Unit, onAccent: (AccentTheme) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Surface(Modifier.fillMaxWidth().testTag("appearance-settings"), shape = RoundedCornerShape(24.dp), color = colors.surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("外观", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text("黑白模式", color = colors.onSurfaceVariant, fontSize = 13.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ThemeMode.entries.forEach { mode ->
                    FilterChip(settings.theme == mode, { onMode(mode) }, label = { Text(mode.label, fontSize = 13.sp) }, modifier = Modifier.testTag("theme-${mode.name}"))
                }
            }
            Text("配色", color = colors.onSurfaceVariant, fontSize = 13.sp)
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AccentTheme.entries.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { accent ->
                            val selected = settings.accent == accent
                            val swatch = mathecaPalette(accent, false).scheme.primary
                            val shape = RoundedCornerShape(12.dp)
                            Surface(Modifier.weight(1f), shape = shape,
                                color = if(selected) colors.secondaryContainer else colors.surface,
                                border = BorderStroke(1.dp, if(selected) colors.primary else colors.outlineVariant)) {
                                Row(Modifier.fillMaxWidth().selectable(selected, role = Role.RadioButton, onClick = { onAccent(accent) })
                                    .heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 10.dp).testTag("accent-${accent.name}"),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Box(Modifier.size(16.dp).clip(CircleShape).background(swatch))
                                    Text(accent.label, Modifier.weight(1f), fontSize = 14.sp, fontWeight = if(selected) FontWeight.SemiBold else FontWeight.Normal)
                                    if(selected) Icon(Icons.Rounded.Check, null, Modifier.size(18.dp), tint = colors.primary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
