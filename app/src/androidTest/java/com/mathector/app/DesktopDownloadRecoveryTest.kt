package com.mathector.app

import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import com.mathector.app.data.DesktopLinkService
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class DesktopDownloadRecoveryTest {
    @Test fun truncatedResponseRetriesFromZeroAndPersistentFailureLeavesNoFile() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<MathectorApplication>()
        val root = File(app.cacheDir, "download-retry-${UUID.randomUUID()}").apply { mkdirs() }
        val context = object : ContextWrapper(app) {
            override fun getFilesDir() = File(root, "files").apply { mkdirs() }
            override fun getCacheDir() = File(root, "cache").apply { mkdirs() }
        }
        val listener = ServerSocket(0).apply { soTimeout = 500 }
        val active = AtomicBoolean(true)
        val alwaysFail = AtomicBoolean(false)
        val downloads = AtomicInteger()
        val content = ByteArray(4096) { (it % 251).toByte() }
        val thread = Thread {
            while(active.get()) {
                try {
                    listener.accept().use { socket ->
                        val reader = socket.getInputStream().bufferedReader()
                        val line = reader.readLine().orEmpty()
                        while(!reader.readLine().isNullOrEmpty()) { }
                        val isDownload = line.contains("/api/download/")
                        val bytes = if(isDownload) content else "{\"approved\":false}".toByteArray()
                        val truncated = isDownload && (downloads.incrementAndGet() == 1 || alwaysFail.get())
                        val output = socket.getOutputStream()
                        output.write("HTTP/1.1 200 OK\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        output.write(bytes, 0, if(truncated) bytes.size / 2 else bytes.size)
                        output.flush()
                    }
                } catch(_: SocketTimeoutException) { }
                catch(_: java.io.IOException) { if(!active.get()) break }
            }
        }.apply { isDaemon = true; start() }
        try {
            val link = DesktopLinkService(context)
            link.connect("http://127.0.0.1:${listener.localPort}/#pair=${"a".repeat(64)}")
            val result = link.downloadLibrary(UUID.randomUUID().toString(), content.size.toLong())
            assertArrayEquals(content, result.readBytes())
            assertEquals(2, downloads.get())
            result.delete()
            alwaysFail.set(true)
            try { link.downloadLibrary(UUID.randomUUID().toString(), content.size.toLong()); fail("must reject incomplete data") }
            catch(error: java.io.IOException) { assertTrue(error.message!!.contains("传输中断")) }
            assertEquals(5, downloads.get())
            assertTrue(context.cacheDir.listFiles().orEmpty().none { it.name.startsWith("desktop-received-") })
        } finally { active.set(false); listener.close(); thread.join(2000); root.deleteRecursively() }
    }
}
