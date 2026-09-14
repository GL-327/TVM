package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class ConnectionTest {
    private val token = "a".repeat(32)

    @Test
    fun acceptsExplicitPrivateLanAndHttps() {
        for (address in listOf(
            "http://10.0.0.1:7345",
            "http://172.16.0.1",
            "http://172.31.255.254",
            "http://192.168.1.2/",
        )) {
            Connection.validated(address, token, true)
        }
        Connection.validated("https://tvm.example", token, false)
    }

    @Test
    fun rejectsPublicOrAmbiguousHttpAndCredentialUrls() {
        for (address in listOf(
            "http://8.8.8.8",
            "http://127.0.0.1",
            "http://172.15.0.1",
            "http://172.32.0.1",
            "http://192.168.1.256",
            "http://192.168.01.1",
            "http://192.168.1.1.evil.example",
            "http://localhost",
            "file:///tmp/index.html",
            "https://user:pass@tvm.example",
            "http://192.168.1.2/?token=secret",
            "http://192.168.1.2/api",
            "http://192.168.1.2/#x",
        )) {
            try {
                Connection.validated(address, token, true)
                throw AssertionError("accepted $address")
            } catch (_: ClientException) {
            }
        }
        try {
            Connection.validated("http://192.168.1.2", token, false)
            throw AssertionError("accepted http without allowLocalHttp")
        } catch (_: ClientException) {
        }
    }

    @Test
    fun rejectsInvalidToken() {
        for (value in listOf("", "short", token + "\r\nX-Test: value", "$token space")) {
            try {
                Connection.validated("https://tvm.example", value, false)
                throw AssertionError("accepted token $value")
            } catch (_: ClientException) {
            }
        }
    }

    @Test
    fun originScopingIncludesPortAndScheme() {
        val connection = Connection.validated("https://tvm.example", token, false)
        assertTrue(connection.isSameOrigin(URI("https://tvm.example:443/api/home")))
        assertFalse(connection.isSameOrigin(URI("https://tvm.example:7345/")))
        assertFalse(connection.isSameOrigin(URI("http://tvm.example/")))
        assertFalse(connection.isSameOrigin(URI("https://tvm.example.evil.example/")))
        assertFalse(connection.isSameOrigin(URI("https://user@tvm.example/")))
        assertEquals("https://tvm.example/api/lan/session", connection.sessionUrl.toString())
    }
}
