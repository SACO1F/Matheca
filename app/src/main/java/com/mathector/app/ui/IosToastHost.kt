package com.mathector.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun IosToastHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    SnackbarHost(state, modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp)) { data ->
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Surface(Modifier.widthIn(max = 420.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("ios-toast"),
                shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
                contentColor = MaterialTheme.colorScheme.onSurface, tonalElevation = 0.dp, shadowElevation = 10.dp,
                border = BorderStroke(.5.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))) {
                Row(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Rounded.Info, null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.primary)
                    Text(data.visuals.message, Modifier.weight(1f, fill = false), fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
                    data.visuals.actionLabel?.let { label -> TextButton(onClick = data::performAction) { Text(label) } }
                    IconButton(onClick = data::dismiss, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Rounded.Close, "关闭提示", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
