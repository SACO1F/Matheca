package com.mathector.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.mathector.app.AppViewModel
import com.mathector.app.BuildConfig
import com.mathector.app.data.*

@Composable
internal fun SettingsScreen(count: Int, jobs: List<ImportJob>, settings: AppSettings, model: AppViewModel, onExportLibrary: () -> Unit, onImportLibrary: () -> Unit, onDesktopLink: () -> Unit) {
    val testing by model.testingApi.collectAsStateWithLifecycle()
    val result by model.apiTestResult.collectAsStateWithLifecycle()
    var privacyOpen by rememberSaveable { mutableStateOf(false) }
    if (privacyOpen) PrivacyPolicyDialog { privacyOpen = false }
    LazyColumn(Modifier.fillMaxSize().testTag("settings-list"), contentPadding = PaddingValues(22.dp, 20.dp, 22.dp, 100.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("我的", fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Text("已保存 $count 道题 · 资料保存在本机", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        } }
        item { AppearanceSettings(settings, model::setTheme, model::setAccent) }
        item { SettingsCard {
            Text("连接电脑", style = MaterialTheme.typography.titleMedium)
            Text("离线收题、发送已有题目与题集，接收电脑整理后的资料。以桌面题库格式保存。", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onDesktopLink, modifier = Modifier.fillMaxWidth().testTag("desktop-link-open")) { Text("打开电脑联动") }
        } }
        item { LibraryBackupCard(onExportLibrary, onImportLibrary) }
        item { ApiConfiguration(settings, testing, result, model) }
        item { SettingsCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("导入后自动解题", fontWeight = FontWeight.SemiBold); Text("可在添加题目时随时切换", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Switch(settings.autoSolveImports, model::setAutoSolveImports)
            }
            Text("默认关闭。开启后调用已配置的接口生成答案与步骤，解答需要核对，可能产生额外服务费用。", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } }
        item { SettingsCard {
            Text("Matheca ${BuildConfig.VERSION_NAME} · 高中数学题集", modifier=Modifier.testTag("app-version"),fontWeight = FontWeight.SemiBold)
            Text("识别结果会保存为待校对草稿。PDF 每个文件最多 20 页，单个文件不超过 50 MB。", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
            Text("PDF 排版导出 · Word 正文可编辑，公式为图片。卸载前请使用“导出题库”保存完整 ZIP 备份。", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
        } }
        item { SettingsCard {
            Text("隐私与数据", fontWeight = FontWeight.SemiBold)
            Text("题库主要保存在本机。识别与解题会把相关题目发送至你配置的 AI 服务；设备联动会传输你选择的资料。", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { privacyOpen = true }, modifier = Modifier.testTag("privacy-policy-open")) { Text("隐私政策") }
        } }
        item { Text("导入记录", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
        if (jobs.isEmpty()) item { Text("暂无导入任务", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(jobs.take(20), key = { it.id }) { job -> SettingsCard {
            Text(job.message, fontSize = 13.sp)
            if (job.status in listOf("failed", "partial")) TextButton(onClick = { model.retry(job.id) }) { Text("重试") }
        } }
    }
}

@Composable private fun SettingsCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable private fun ApiConfiguration(settings: AppSettings, testing: Boolean, result: String?, model: AppViewModel) {
    var address by rememberSaveable(settings.address) { mutableStateOf(settings.address) }
    var modelName by rememberSaveable(settings.model) { mutableStateOf(settings.model) }
    // Keys are deliberately absent from SavedState/rememberSaveable and are never prefilled from storage.
    var newKey by remember { mutableStateOf("") }
    var showKey by remember { mutableStateOf(false) }
    val unsaved = address.trim() != settings.address || modelName.trim() != settings.model || newKey.isNotBlank()
    SettingsCard(Modifier.testTag("recognition-api-settings")) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Rounded.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary)
            Text("题目识别与接口", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.weight(1f))
            Text("多模态识别", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("recognition-multimodal"))
        }
        Text("图片和 PDF 通过所填接口提取题干、公式和分类，需使用支持图片的模型并联网。", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
        OutlinedTextField(address, { address = it }, modifier = Modifier.fillMaxWidth().testTag("api-address"), label = { Text("接口地址") },
            placeholder = { Text("https://服务地址/v1", fontSize = 12.sp) }, singleLine = true, shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Uri))
        Text("支持 HTTPS 基础地址或完整的 /chat/completions 地址", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        OutlinedTextField(modelName, { modelName = it }, modifier = Modifier.fillMaxWidth().testTag("api-model"), label = { Text("模型名") },
            singleLine = true, shape = RoundedCornerShape(14.dp), keyboardOptions = KeyboardOptions(autoCorrectEnabled = false))
        OutlinedTextField(newKey, { newKey = it }, modifier = Modifier.fillMaxWidth().testTag("api-key"), label = { Text("API Key") },
            placeholder = { Text(if(settings.hasApiKey) "已加密保存，留空保留" else "填写你的 API Key", fontSize = 12.sp) }, singleLine = true,
            shape = RoundedCornerShape(14.dp), visualTransformation = if(showKey) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
            trailingIcon = { IconButton(onClick = { showKey = !showKey }) { Icon(if(showKey) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if(showKey) "隐藏 API Key" else "显示 API Key") } })
        Text(if(settings.hasApiKey) "API Key 已使用设备密钥加密保存" else "API Key 仅保存在本机，配置后才能开始多模态识别", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { model.saveApi(address, modelName, newKey) { newKey = ""; showKey = false } },
                modifier = Modifier.weight(1f).testTag("save-api"), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
                enabled = !testing && address.isNotBlank() && modelName.isNotBlank() && (newKey.isNotBlank() || settings.hasApiKey)) { Text("保存接口配置", fontSize = 13.sp) }
            OutlinedButton(onClick = model::testApi, modifier = Modifier.weight(1f).testTag("test-api"), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 10.dp),
                enabled = !testing && !unsaved && settings.hasApiKey && settings.address.isNotBlank() && settings.model.isNotBlank()) {
                if (testing) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(6.dp)) }
                Text(if(testing) "识别测试中" else "测试图片识别", fontSize = 13.sp)
            }
        }
        Text("测试会发送一张内置题目图片，可能产生服务费用。修改配置后请先保存。", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp)
        result?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("api-test-result")) }
        if(settings.hasApiKey) TextButton(onClick = { newKey = ""; model.clearApiKey() }) { Text("清除已保存的 API Key") }
    }
}
