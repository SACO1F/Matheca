package com.mathector.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mathector.app.data.BackupSummary

@Composable internal fun LibraryBackupCard(onExport: () -> Unit, onImport: () -> Unit) {
    Surface(Modifier.fillMaxWidth().testTag("library-backup-settings"), shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("题库导入与导出", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            BackupDescription()
            BackupActions("backup-settings", onExport, onImport)
        }
    }
}

@Composable internal fun LibraryBackupDialog(onDismiss: () -> Unit, onExport: () -> Unit, onImport: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, modifier = Modifier.testTag("library-backup-dialog"), shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface, title = { Text("题库导入与导出", fontWeight = FontWeight.Bold) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(14.dp)) { BackupDescription(); BackupActions("backup-dialog", onExport, onImport) } },
        confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } })
}

@Composable private fun BackupDescription() {
    Text("将题目、原图、解答、题集与自定义知识点保存为 ZIP 备份。重新安装后可直接导入继续使用。", fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text("卸载前请保存到下载文件夹或云盘。导入会合并数据，保留本机已有版本；备份不含接口密钥。", fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun BackupActions(prefix: String, onExport: () -> Unit, onImport: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = onExport, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("$prefix-export"),
            shape = RoundedCornerShape(50.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)) {
            Icon(Icons.Rounded.FileUpload, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("导出题库", fontSize = 13.sp)
        }
        FilledTonalButton(onClick = onImport, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("$prefix-import"),
            shape = RoundedCornerShape(50.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)) {
            Icon(Icons.Rounded.FileDownload, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("导入题库", fontSize = 13.sp)
        }
    }
}

@Composable internal fun BackupProgressDialog(progress: String, onCancel: () -> Unit) {
    AlertDialog(onDismissRequest = {}, modifier = Modifier.testTag("backup-progress"), shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface, title = { Text("题库备份") },
        text = { Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            Text(progress, fontSize = 14.sp)
        } }, confirmButton = { TextButton(onClick = onCancel, modifier = Modifier.testTag("backup-cancel")) { Text("取消") } })
}

@Composable internal fun BackupImportDialog(summary: BackupSummary, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, modifier = Modifier.testTag("backup-import-preview"), shape = RoundedCornerShape(28.dp),
        containerColor = MaterialTheme.colorScheme.surface, title = { Text("导入题库备份", fontWeight = FontWeight.Bold) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${summary.questions} 道题目 · ${summary.collections} 个题集", fontWeight = FontWeight.SemiBold)
            Text(buildString { append("${summary.images} 张原图"); if(summary.figures > 0) append(" · ${summary.figures} 张题目图片"); append(" · ${summary.knowledgePoints} 个自定义知识点") }, fontSize = 13.sp)
            Text("将合并到当前题库。同编号题目和题集保留本机版本，重复导入不会重复添加。", fontSize = 13.sp)
            if(summary.missingImages > 0) Text("备份中 ${summary.missingImages} 道题的原图已缺失，题干和其他数据仍可恢复。", fontSize = 12.sp)
            if(summary.missingFigures > 0) Text("备份中 ${summary.missingFigures} 张题目图片已缺失，题干和其他数据仍可恢复。", fontSize = 12.sp)
        } }, confirmButton = { TextButton(onClick = onConfirm, modifier = Modifier.testTag("backup-import-confirm")) { Text("导入题库") } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("backup-import-cancel")) { Text("取消") } })
}
