package com.mathector.app.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.util.UUID
import java.util.concurrent.TimeUnit

data class DesktopConnection(val base: String, val token: String) {
    companion object {
        fun parse(text: String): DesktopConnection {
            val uri = URI(text.trim())
            require(uri.scheme == "http" && uri.userInfo == null && uri.query == null && (uri.path.isNullOrEmpty() || uri.path == "/") && uri.port in 1..65535) { "请扫描电脑“手机联动”的二维码，或粘贴完整连接地址" }
            val parts = uri.host.orEmpty().split('.')
            require(parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 && it == it.toIntOrNull().toString() }) { "仅支持电脑的局域网 IPv4 地址" }
            val a = parts.map(String::toInt)
            require(a[0] == 10 || a[0] == 127 || a[0] == 192 && a[1] == 168 || a[0] == 172 && a[1] in 16..31) { "仅允许连接局域网电脑" }
            require(uri.rawFragment.orEmpty().startsWith("pair=")) { "连接凭证无效，请重新扫码" }
            val token = uri.rawFragment.orEmpty().removePrefix("pair=")
            require(Regex("[a-f0-9]{64}").matches(token)) { "连接凭证无效，请重新扫码" }
            return DesktopConnection("http://${uri.host}:${uri.port}", token)
        }
    }
}
data class DesktopQueueItem(val id: String, val name: String, val kind: String, val status: String = "queued", val error: String = "")
data class SavedDesktop(val id: String, val base: String, val credential: String)
@android.annotation.SuppressLint("UseKtx") // commit() success must be checked before publishing durable queue state.
class DesktopLinkService(private val context: Context) {
    private val folder = File(context.filesDir, "desktop-queue").apply { mkdirs() }
    private val manifest = AtomicFile(File(folder, "queue.json"))
    private val preferences = context.getSharedPreferences("desktop-link", Context.MODE_PRIVATE)
    private val device = preferences.getString("device", null) ?: UUID.randomUUID().toString().replace("-", "").also { check(preferences.edit().putString("device", it).commit()) }
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(7, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).writeTimeout(120, TimeUnit.SECONDS).build()
    private var connection: DesktopConnection? = null
    private var expectedServer: String? = null
    private val pollLock = Mutex()
    private var inventoryAt = 0L
    var inventoryProvider: (suspend () -> JSONObject)? = null
    val savedDesktops = MutableStateFlow<List<SavedDesktop>>(emptyList())
    private var loadFailed = false
    val queue = MutableStateFlow<List<DesktopQueueItem>>(emptyList())
    val state = MutableStateFlow<JSONObject?>(null)
    val progress = MutableStateFlow("")
    init {
        runCatching {
            val a=JSONArray(preferences.getString("desktops","[]"))
            require(a.length()<=10)
            savedDesktops.value=List(a.length()) { val o=a.getJSONObject(it); val entry=SavedDesktop(o.getString("id"),o.getString("base"),o.getString("credential")); require(Regex("[a-f0-9-]{36}").matches(entry.id)); DesktopConnection.parse(entry.base+"/#pair="+entry.credential); entry }
        }.onFailure { progress.value="已保存的电脑记录无法读取，请重新扫码；待传队列仍保留" }
        try { if(manifest.baseFile.exists()) {
            val a = JSONArray(manifest.openRead().bufferedReader().use { it.readText() })
            require(a.length() <= 100) { "待传队列记录过多，请保留数据后联系维护者" }
            queue.value = List(a.length()) { n -> val o = a.getJSONObject(n)
                val id = o.getString("id"); require(Regex("[a-f0-9-]{36}").matches(id)); val kind = o.getString("kind"); require(kind in listOf("photo", "library"))
                DesktopQueueItem(id, o.getString("name"), kind, o.optString("status", "queued"), o.optString("error"))
            }.filter { file(it).isFile }
        } } catch(_: Exception) { loadFailed = true; progress.value = "待传记录无法读取，原文件仍保留，请先备份后联系维护者" }
    }
    private fun file(item: DesktopQueueItem) = File(folder, item.id + if(item.kind == "library") ".zip" else ".photo")
    fun previewFile(id: String): File? = queue.value.find { it.id == id && it.kind == "photo" }?.let(::file)
    private fun usedBytes() = queue.value.sumOf { file(it).length() }
    private fun commit(items: List<DesktopQueueItem>) {
        check(!loadFailed) { "待传记录无法读取，原文件仍保留，请先备份后联系维护者" }
        val a = JSONArray().apply { items.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("kind", it.kind).put("status", it.status).put("error", it.error)) } }
        val stream = manifest.startWrite()
        try { stream.write(a.toString().toByteArray()); manifest.finishWrite(stream) } catch(error: Throwable) { manifest.failWrite(stream); throw error }
        queue.value = items
    }
    suspend fun addPhotos(uris: List<Uri>) = withContext(Dispatchers.IO) {
        require(queue.value.size + uris.size <= 100) { "本机队列最多保留 100 项，请先发送并清理" }
        for(uri in uris) {
            currentCoroutineContext().ensureActive()
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if(c.moveToFirst()) c.getString(0) else null } ?: "拍摄照片.jpg"
            val item = DesktopQueueItem(UUID.randomUUID().toString(), name.take(150), "photo")
            val file = file(item)
            val existingBytes = usedBytes()
            try {
                val input = context.contentResolver.openInputStream(uri) ?: error("无法读取照片，请重新选择")
                input.use { source -> file.outputStream().use { output -> val buffer = ByteArray(16384); var bytes = 0L; while(true) { currentCoroutineContext().ensureActive(); val n = source.read(buffer); if(n < 0) break; bytes += n; require(bytes <= 50L*1024*1024 && existingBytes + bytes <= BackupPolicy.MAX_ARCHIVE_BYTES) { "单张照片最多 50 MB" }; output.write(buffer, 0, n) }; require(bytes > 0) { "照片为空" } } }
                commit(queue.value + item)
            } catch(error: Throwable) { file.delete(); throw error }
        }
    }
    suspend fun addLibrary(archive: File, name: String) = withContext(Dispatchers.IO) {
        require(queue.value.size < 100) { "待传队列已满" }
        require(usedBytes() + archive.length() <= BackupPolicy.MAX_ARCHIVE_BYTES) { "待传内容合计最多 512 MB，请先发送并清理" }
        val item = DesktopQueueItem(UUID.randomUUID().toString(), name, "library")
        val file = file(item)
        try { archive.copyTo(file); commit(queue.value + item) } catch(error: Throwable) { file.delete(); throw error }
    }
    suspend fun remove(id: String) = withContext(Dispatchers.IO) {
        val item = queue.value.find { it.id == id } ?: return@withContext
        commit(queue.value.filter { it.id != id }); file(item).delete()
    }
    suspend fun move(id: String, delta: Int) = withContext(Dispatchers.IO) {
        val list = queue.value.toMutableList(); val index = list.indexOfFirst { it.id == id }; val target = index + delta
        if(index >= 0 && target in list.indices) { val item = list.removeAt(index); list.add(target, item); commit(list) }
    }
    suspend fun connect(text: String) {
        if(android.os.Build.VERSION.SDK_INT >= 37) require(context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK") == android.content.pm.PackageManager.PERMISSION_GRANTED) { "请在连接页面允许局域网／附近设备权限后重试" }
        connection = DesktopConnection.parse(text); expectedServer=null; state.value=null; inventoryAt=0; poll(true)
    }
    suspend fun reconnect(id: String) {
        val saved=savedDesktops.value.find { it.id==id } ?: error("电脑记录已移除，请重新扫码")
        if(android.os.Build.VERSION.SDK_INT>=37) require(context.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK")==android.content.pm.PackageManager.PERMISSION_GRANTED) { "请允许局域网权限后重试" }
        connection=DesktopConnection(saved.base,saved.credential); state.value=null; inventoryAt=0; expectedServer=id
        poll(true)
        require(state.value?.optString("serverId")==id && state.value?.optBoolean("approved")==true) { disconnect(); "电脑身份已变化，请重新扫码" }
    }
    private fun saveDesktops(list: List<SavedDesktop>) {
        val a=JSONArray().apply { list.forEach { put(JSONObject().put("id",it.id).put("base",it.base).put("credential",it.credential)) } }
        check(preferences.edit().putString("desktops",a.toString()).commit()) { "无法保存电脑配对" }; savedDesktops.value=list
    }
    suspend fun remember() = withContext(Dispatchers.IO) {
        require(state.value?.optBoolean("approved")==true) { "请先在电脑允许连接" }
        val c=connection ?: error("连接已结束")
        val response=client.newCall(request("/api/trust").header("X-Device-Name",java.net.URLEncoder.encode(android.os.Build.MODEL,"UTF-8").replace("+","%20")).post(ByteArray(0).toRequestBody()).build()).execute().use { read(it) }
        val id=response.getString("serverId"); val credential=response.getString("credential")
        require(id==state.value?.optString("serverId") && Regex("[a-f0-9]{64}").matches(credential)) { "电脑身份无效，请重新扫码" }
        require(savedDesktops.value.any { it.id==id } || savedDesktops.value.size<10) { "最多保存 10 台电脑，请先移除旧记录" }
        saveDesktops(savedDesktops.value.filter { it.id!=id } + SavedDesktop(id,c.base,credential)); poll()
    }
    fun forget(id: String) { saveDesktops(savedDesktops.value.filter { it.id!=id }); if(state.value?.optString("serverId")==id) disconnect() }
    fun disconnect() { connection = null; expectedServer=null; state.value = null; inventoryAt=0; client.dispatcher.cancelAll() }
    private fun request(path: String): Request.Builder {
        val c = connection ?: error("请先连接电脑")
        return Request.Builder().url(c.base + path).header("Authorization", "Bearer " + c.token).header("X-Device-Id", device)
    }
    private fun read(response: Response): JSONObject {
        val data = JSONObject(response.body?.string().orEmpty().ifBlank { "{}" })
        require(response.isSuccessful) { data.optString("error", "连接失败，请重新扫码") }; return data
    }
    suspend fun poll(refreshInventory: Boolean = false) = withContext(Dispatchers.IO) { pollLock.withLock {
        val active=connection ?: error("请先连接电脑")
        val received=client.newCall(request("/api/state").build()).execute().use { read(it) }
        if(connection!==active) return@withContext
        expectedServer?.let { require(received.optString("serverId")==it) { "电脑身份已变化，请重新扫码" } }
        state.value=received
        val data = state.value ?: return@withContext
        expectedServer?.let { require(data.optString("serverId")==it) { "电脑身份已变化，请重新扫码" } }
        if(data.optBoolean("approved")) {
            val current=connection
            val remembered=savedDesktops.value.find { it.id==data.optString("serverId") }
            if(current!=null && remembered!=null && remembered.base!=current.base) saveDesktops(savedDesktops.value.map { if(it.id==remembered.id) it.copy(base=current.base) else it })
            val receipts = data.optJSONArray("receipts"); val libraries = data.optJSONArray("libraries")
            val photoIds = if(receipts == null) emptySet() else List(receipts.length()) { receipts.getJSONObject(it).getString("uploadId") }.toSet()
            val libraryIds = if(libraries == null) emptySet() else List(libraries.length()) { libraries.getJSONObject(it).getString("id") }.toSet()
            val updated = queue.value.map { item -> if((item.kind == "photo" && item.id.replace("-", "") in photoIds || item.kind == "library" && item.id in libraryIds) && item.status != "sent") item.copy(status = "sent", error = "") else item }
            if(updated != queue.value) commit(updated)
            if(data.optInt("inventoryVersion")==1 && (refreshInventory || System.currentTimeMillis()-inventoryAt>15000)) {
                inventoryProvider?.let { provider ->
                    val body=provider().toString().toRequestBody("application/json".toMediaType())
                    client.newCall(request("/api/inventory").post(body).build()).execute().use { read(it) }
                    inventoryAt=System.currentTimeMillis()
                }
            }
        }
    } }
    suspend fun remoteInventory(): JSONObject = withContext(Dispatchers.IO) {
        require(state.value?.optBoolean("approved")==true) { "请先连接并在电脑允许" }
        client.newCall(request("/api/inventory").build()).execute().use { ExchangeInventory.validate(read(it)) }
    }
    suspend fun send() = withContext(Dispatchers.IO) {
        poll(); require(state.value?.optBoolean("approved") == true) { "请先在电脑核对并允许连接" }
        for(item in queue.value.filter { it.status != "sent" }) {
            currentCoroutineContext().ensureActive()
            val source = file(item)
            val type = if(item.kind == "library") "application/zip" else "application/octet-stream"
            val delegate = source.asRequestBody(type.toMediaType())
            val body = object : RequestBody() {
                override fun contentType() = delegate.contentType()
                override fun contentLength() = source.length()
                override fun writeTo(sink: BufferedSink) {
                    source.inputStream().use { input -> val buffer = ByteArray(16384); var bytes = 0L
                        while(true) { val n = input.read(buffer); if(n < 0) break; sink.write(buffer, 0, n); bytes += n; progress.value = "${item.name} · ${bytes * 100 / source.length().coerceAtLeast(1)}%" }
                    }
                }
            }
            try {
                val path = if(item.kind == "library") "/api/library" else "/api/upload"
                val req = request(path).header("X-Upload-Id", if(item.kind == "library") item.id else item.id.replace("-", ""))
                    .header("X-File-Name", java.net.URLEncoder.encode(item.name, "UTF-8").replace("+", "%20")).post(body).build()
                client.newCall(req).execute().use { read(it) }
                commit(queue.value.map { if(it.id == item.id) it.copy(status = "sent", error = "") else it })
            } catch(error: Exception) { commit(queue.value.map { if(it.id == item.id) it.copy(status = "error", error = error.message ?: "发送失败") else it }); throw error }
        }
        progress.value = "发送完成，电脑收到后还需确认识别或接收题库"; poll()
    }
    suspend fun downloadLibrary(id: String, size: Long): File = withContext(Dispatchers.IO) {
        require(Regex("[a-f0-9-]{36}").matches(id) && size in 1..BackupPolicy.MAX_ARCHIVE_BYTES) { "资料编号或大小无效" }
        val target = File.createTempFile("desktop-received-", ".zip", context.cacheDir)
        try {
            client.newCall(request("/api/download/$id").build()).execute().use { response ->
                require(response.isSuccessful) { "下载失败，请检查连接后重试" }
                val input = response.body?.byteStream() ?: error("文件为空")
                input.use { source -> target.outputStream().use { output -> val bytes = ByteArray(16384); var total = 0L
                    while(true) { currentCoroutineContext().ensureActive(); val n = source.read(bytes); if(n < 0) break; total += n; require(total <= size) { "资料超出申报大小" }; output.write(bytes, 0, n); progress.value = "接收题库 · ${total*100/size}%" }
                    require(total == size) { "文件未完整收到，请重试" }
                } }
            }; target
        } catch(error: Throwable) { target.delete(); throw error }
    }
}
