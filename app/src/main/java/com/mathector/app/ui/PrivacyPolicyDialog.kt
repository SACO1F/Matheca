package com.mathector.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject

@Composable
internal fun PrivacyPolicyDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val policy = remember { context.assets.open("privacy-policy.json").bufferedReader().use { JSONObject(it.readText()) } }
    var contactError by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.padding(horizontal = 20.dp, vertical = 24.dp).widthIn(max = 640.dp)
            .fillMaxWidth().heightIn(max = 760.dp).testTag("privacy-policy-dialog"),
            shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface) {
            Column {
                Column(Modifier.padding(24.dp, 22.dp, 24.dp, 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(policy.getString("title"), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                    Text("更新与生效日期：${policy.getString("effectiveDate")}", fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SelectionContainer(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).testTag("privacy-policy-body")) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(policy.getString("summary"), fontSize = 14.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium)
                        val sections = policy.getJSONArray("sections")
                        for (index in 0 until sections.length()) {
                            val section = sections.getJSONObject(index)
                            Text(section.getString("title"), Modifier.padding(top = 12.dp), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            val paragraphs = section.getJSONArray("paragraphs")
                            for (paragraph in 0 until paragraphs.length()) {
                                Text(paragraphs.getString(paragraph), fontSize = 14.sp, lineHeight = 24.sp)
                            }
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                if (contactError) Text("无法打开浏览器，请使用政策中的反馈网址。", Modifier.padding(horizontal = 24.dp, vertical = 8.dp), fontSize = 12.sp)
                FlowRow(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { contactError = runCatching { uriHandler.openUri(policy.getString("contactUrl")) }.isFailure }) { Text("联系维护者") }
                    TextButton(onClick = onDismiss, modifier = Modifier.testTag("privacy-policy-close")) { Text("关闭") }
                }
            }
        }
    }
}
