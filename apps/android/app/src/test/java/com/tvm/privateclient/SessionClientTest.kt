package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SessionClientTest {
    private val token = "a".repeat(32)
    private val https = Connection.validated("https://tvm.example", token, false)
    private val http = Connection.validated("http://192.168.1.20:7345", token, true)

    @Test
    fun acceptsCoreHttpOnlyCookie() {
        val cookie = SessionClient.parseSetCookie(
            "tvm_lan_session=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200",
            http,
        )
        assertNotNull(cookie)
        assertEquals("tvm_lan_session", cookie!!.name)
        assertEquals("abc", cookie.value)
        assertEquals("tvm_lan_session=abc", cookie.requestHeader)
    }

    @Test
    fun requiresSecureOnHttps() {
        assertNull(
            SessionClient.parseSetCookie(
                "tvm_lan_session=abc; Path=/; HttpOnly; SameSite=Strict",
                https,
            ),
        )
        assertNotNull(
            SessionClient.parseSetCookie(
                "tvm_lan_session=abc; Path=/; HttpOnly; SameSite=Strict; Secure",
                https,
            ),
        )
    }

    @Test
    fun rejectsMissingHttpOnlyWrongNameOrPath() {
        assertNull(SessionClient.parseSetCookie("tvm_lan_session=abc; Path=/", http))
        assertNull(SessionClient.parseSetCookie("other=abc; Path=/; HttpOnly", http))
        assertNull(SessionClient.parseSetCookie("tvm_lan_session=abc; Path=/api; HttpOnly", http))
        assertNull(SessionClient.parseSetCookie("tvm_lan_session=abc; Path=/; HttpOnly; Domain=evil.example", http))
    }

    @Test
    fun webViewCookieKeepsHttpOnlyPathAndSecureOnHttps() {
        val cookie = SessionCookie("tvm_lan_session", "abc")
        assertEquals(
            "tvm_lan_session=abc; Path=/; HttpOnly; SameSite=Strict; Secure",
            cookie.webViewCookie(true),
        )
        assertEquals(
            "tvm_lan_session=abc; Path=/; HttpOnly; SameSite=Strict",
            cookie.webViewCookie(false),
        )
    }
}
