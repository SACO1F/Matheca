package com.mathector.app
import com.mathector.app.data.DesktopConnection
import org.junit.Assert.*
import org.junit.Test

class DesktopConnectionTest {
    private val token = "a".repeat(64)
    @Test fun acceptsOnlyExplicitLanIpv4AndPairingCredentials() {
        assertEquals("http://192.168.1.3:8080", DesktopConnection.parse("http://192.168.1.3:8080/#pair=$token").base)
        assertEquals(token, DesktopConnection.parse("http://10.0.2.2:1234/#pair=$token").token)
        for(host in listOf("example.com", "8.8.8.8", "192.168.1.256", "192.168.001.1", "127.0.0.1.evil.com")) rejects("http://$host:8080/#pair=$token")
        rejects("https://192.168.1.3:8080/#pair=$token")
        rejects("http://user@192.168.1.3:8080/#pair=$token")
        rejects("http://192.168.1.3:8080/?x=1#pair=$token")
        rejects("http://192.168.1.3:8080/path#pair=$token")
        rejects("http://192.168.1.3:8080/#pair=bad")
        rejects("http://192.168.1.3/#pair=$token")
    }
    private fun rejects(value: String) { try { DesktopConnection.parse(value); fail("Accepted invalid pairing URI") } catch(_: IllegalArgumentException) {} }
}
