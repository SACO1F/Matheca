package com.mathector.app.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

enum class ThemeMode(val label: String) { SYSTEM("跟随系统"), LIGHT("白天"), DARK("黑夜") }
enum class AccentTheme(val label: String) { GRAPHITE("石墨"), BLUE("雾蓝"), CLAY("陶土"), PLUM("梅紫") }

data class AppSettings(
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val address: String = "",
    val model: String = "",
    val hasApiKey: Boolean = false,
    val autoSolveImports: Boolean = false,
    val accent: AccentTheme = AccentTheme.GRAPHITE,
) {
    val recognitionReady: Boolean get() = address.isNotBlank() && model.isNotBlank() && hasApiKey
}

/** Contains credentials only for the duration of a request; never expose it in UI state or logs. */
class MultimodalConfig(val endpoint: HttpUrl, val model: String, val apiKey: String) {
    init {
        require(endpoint.isHttps && endpoint.username.isEmpty() && endpoint.password.isEmpty() && endpoint.query == null && endpoint.fragment == null) { "请填写不含账号、参数的 HTTPS 接口地址" }
        require(model.isNotBlank()) { "请填写支持图片输入的模型名" }
        require(apiKey.isNotBlank() && apiKey.all { it in '!'..'~' }) { "请填写有效的 API Key" }
    }
}

/** Accept a service root, /v1 base URL or an exact /chat/completions endpoint. */
fun chatCompletionsEndpoint(address: String): HttpUrl {
    val url = address.trim().toHttpUrlOrNull() ?: error("接口地址格式不正确")
    require(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "请使用不含账号、参数的 HTTPS 接口地址" }
    val path = url.encodedPath.trimEnd('/')
    return when {
        path.endsWith("/chat/completions") -> url.newBuilder().encodedPath(path).build()
        path.isEmpty() -> url.newBuilder().encodedPath("/v1/chat/completions").build()
        else -> url.newBuilder().encodedPath("$path/chat/completions").build()
    }
}

class SettingsStore(context: Context, name: String = "mathector-settings", private val keyAlias: String = "mathector-api-key") {
    private val preferences = context.getSharedPreferences(name, Context.MODE_PRIVATE).also {
        // Retire the old offline choice without changing the user's interface configuration.
        if(it.contains("recognitionMode")) it.edit().remove("recognitionMode").apply()
    }
    private val mutable = MutableStateFlow(readSettings())
    val state = mutable.asStateFlow()

    private fun readSettings() = AppSettings(
        theme = ThemeMode.entries.find { it.name == preferences.getString("theme", null) } ?: ThemeMode.SYSTEM,
        address = preferences.getString("address", "").orEmpty(), model = preferences.getString("model", "").orEmpty(),
        hasApiKey = preferences.contains("encryptedKey"),
        autoSolveImports = preferences.getBoolean("autoSolveImports", false),
        accent = AccentTheme.entries.find { it.name == preferences.getString("accent", null) } ?: AccentTheme.GRAPHITE,
    )

    @Synchronized fun setTheme(theme: ThemeMode) {
        check(preferences.edit().putString("theme", theme.name).commit()) { "主题设置保存失败" }
        mutable.value = readSettings()
    }

    @Synchronized fun setAutoSolveImports(enabled: Boolean) {
        check(preferences.edit().putBoolean("autoSolveImports", enabled).commit()) { "自动解题设置保存失败" }
        mutable.value = readSettings()
    }

    @Synchronized fun setAccent(accent: AccentTheme) {
        check(preferences.edit().putString("accent", accent.name).commit()) { "配色设置保存失败" }
        mutable.value = readSettings()
    }

    @Synchronized fun saveApi(address: String, model: String, newKey: String) {
        val endpoint = chatCompletionsEndpoint(address)
        require(model.trim().isNotEmpty()) { "请填写支持图片输入的模型名" }
        val previousAddress = state.value.address
        if (state.value.hasApiKey && previousAddress.isNotBlank() && chatCompletionsEndpoint(previousAddress).host != endpoint.host) {
            require(newKey.isNotBlank()) { "更换服务地址时请重新填写 API Key" }
        }
        val key = newKey.trim().ifBlank { readApiKey() }
        MultimodalConfig(endpoint, model.trim(), key)
        val editor = preferences.edit().putString("address", address.trim()).putString("model", model.trim())
        if (newKey.isNotBlank()) {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            cipher.updateAAD(keyAlias.toByteArray(Charsets.UTF_8))
            editor.putString("encryptedKey", Base64.encodeToString(cipher.doFinal(key.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
                .putString("keyIv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
        }
        check(editor.commit()) { "接口配置保存失败" }
        mutable.value = readSettings()
    }

    @Synchronized fun clearApiKey() {
        check(preferences.edit().remove("encryptedKey").remove("keyIv").commit()) { "API Key 清除失败" }
        mutable.value = readSettings()
    }

    @Synchronized fun multimodalConfig(): MultimodalConfig {
        val settings = state.value
        require(settings.address.isNotBlank() && settings.model.isNotBlank() && settings.hasApiKey) { "请先在“我的”中配置多模态接口" }
        return MultimodalConfig(chatCompletionsEndpoint(settings.address), settings.model, readApiKey())
    }

    private fun readApiKey(): String {
        val encrypted = preferences.getString("encryptedKey", null) ?: error("请填写 API Key")
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(preferences.getString("keyIv", null), Base64.NO_WRAP)))
            cipher.updateAAD(keyAlias.toByteArray(Charsets.UTF_8))
            String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) { error("API Key 无法读取，请重新填写后保存") }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
}
