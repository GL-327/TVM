package com.tvm.privateclient

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import org.json.JSONObject

/** No token or host is stored in WebView storage, logs or plain SharedPreferences. */
object CredentialStore {
    private const val PREFS = "tvm.privateclient.connection"
    private const val KEY = "active"

    fun read(context: Context): Connection? {
        val raw = prefs(context).getString(KEY, null) ?: return null
        return try {
            val json = JSONObject(raw)
            Connection.validated(
                json.getString("origin"),
                json.getString("token"),
                json.optBoolean("allowLocalHTTP", false),
            )
        } catch (_: Exception) {
            null
        }
    }

    fun save(context: Context, connection: Connection) {
        val json = JSONObject()
            .put("origin", connection.origin.toString())
            .put("token", connection.token)
            .put("allowLocalHTTP", connection.allowLocalHttp)
        try {
            prefs(context).edit().putString(KEY, json.toString()).apply()
        } catch (_: Exception) {
            throw ClientException("Unable to save this connection securely. Unlock your device and retry.")
        }
    }

    fun clear(context: Context) {
        try {
            prefs(context).edit().remove(KEY).apply()
        } catch (_: Exception) {
            throw ClientException("Unable to remove the saved connection. Unlock your device and retry.")
        }
    }

    private fun prefs(context: Context) = EncryptedSharedPreferences.create(
        PREFS,
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
}

/**
 * The accounts session token, and nothing else about the account, in the same
 * encrypted preferences the connection uses. It is the only account data kept
 * on the phone: passwords and Real-Debrid keys live in the accounts service.
 * Reads and writes never throw; a phone that cannot reach secure storage just
 * signs in again.
 */
class EncryptedSessionVault(
    private val context: Context,
    private val keyName: String = KEY,
) : TvmSessionVault {
    override fun read(): String? = try {
        prefs().getString(keyName, null)?.ifEmpty { null }
    } catch (_: Exception) {
        null
    }

    override fun write(token: String?) {
        try {
            val edit = prefs().edit()
            if (token.isNullOrEmpty()) edit.remove(keyName) else edit.putString(keyName, token)
            edit.apply()
        } catch (_: Exception) {
            // Secure storage is locked or unavailable. The session still works until the app closes.
        }
    }

    private fun prefs() = EncryptedSharedPreferences.create(
        PREFS,
        MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private companion object {
        const val PREFS = "tvm.privateclient.account"
        const val KEY = "session"
    }
}
