package com.mathector.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mathector.app.R

/** Align with the system's padded 96dp launch icon, then reveal the app tagline. */
@Composable
internal fun StartupScreen() {
    Box(Modifier.fillMaxSize().background(Color(0xFFF5F5F5)).testTag("startup-screen")) {
        Image(painterResource(R.drawable.ic_launcher), "Matheca LOGO",
            Modifier.align(Alignment.Center).size(96.dp).testTag("startup-logo"))
        Text(stringResource(R.string.startup_tagline),
            Modifier.align(Alignment.Center).offset(y = 84.dp).fillMaxWidth().padding(horizontal = 24.dp).testTag("startup-tagline"),
            color = Color(0xFF696969), fontSize = 16.sp, lineHeight = 24.sp,
            fontWeight = FontWeight.Normal, textAlign = TextAlign.Center)
    }
}
