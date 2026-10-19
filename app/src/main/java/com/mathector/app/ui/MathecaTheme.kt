package com.mathector.app.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import com.mathector.app.data.AccentTheme

/** Light tokens follow Matheca desktop/workbench-theme.css; dark tones are Android adaptations. */
@Immutable
internal data class MathecaPalette(
    val scheme: ColorScheme,
    val card: Color,
    val menu: Color,
    val tagInk: Color,
    val tagSurface: Color,
    val success: Color,
    val warning: Color,
)

internal fun mathecaPalette(accent: AccentTheme, dark: Boolean): MathecaPalette {
    val ink = when(accent) {
        AccentTheme.GRAPHITE -> Color(0xFF252525)
        AccentTheme.BLUE -> Color(0xFF315A86)
        AccentTheme.CLAY -> Color(0xFF8A4C38)
        AccentTheme.PLUM -> Color(0xFF74516D)
    }
    val soft = when(accent) {
        AccentTheme.GRAPHITE -> Color(0xFFE8E8E8)
        AccentTheme.BLUE -> Color(0xFFE7EFF7)
        AccentTheme.CLAY -> Color(0xFFF5EAE5)
        AccentTheme.PLUM -> Color(0xFFF1EAF0)
    }
    val nightInk = when(accent) {
        AccentTheme.GRAPHITE -> Color(0xFFE2E2E2)
        AccentTheme.BLUE -> Color(0xFFAFCBE8)
        AccentTheme.CLAY -> Color(0xFFEABBA9)
        AccentTheme.PLUM -> Color(0xFFD9BAD2)
    }
    val nightSoft = when(accent) {
        AccentTheme.GRAPHITE -> Color(0xFF343434)
        AccentTheme.BLUE -> Color(0xFF293A4C)
        AccentTheme.CLAY -> Color(0xFF48342D)
        AccentTheme.PLUM -> Color(0xFF41323E)
    }
    val primary = if(dark) nightInk else ink
    val selected = if(dark) nightSoft else soft
    val bg = if(dark) Color(0xFF181818) else Color(0xFFF5F5F5)
    val panel = if(dark) Color(0xFF222222) else Color.White
    val text = if(dark) Color(0xFFE8E8E8) else Color(0xFF262626)
    val muted = if(dark) Color(0xFFB3B3B3) else Color(0xFF696969)
    val line = if(dark) Color(0xFF464646) else Color(0xFFE6E6E6)
    val controlLine = if(dark) Color(0xFF8B8B8B) else Color(0xFF808080)
    val error = if(dark) Color(0xFFF3A7B6) else Color(0xFFA23245)
    val errorSoft = if(dark) Color(0xFF492A31) else Color(0xFFFBECEF)
    val base = if(dark) darkColorScheme() else lightColorScheme()
    val scheme = base.copy(
        primary = primary, onPrimary = if(dark) Color(0xFF181818) else Color.White,
        primaryContainer = selected, onPrimaryContainer = primary,
        inversePrimary = ink,
        secondary = primary, onSecondary = if(dark) Color(0xFF181818) else Color.White,
        secondaryContainer = selected, onSecondaryContainer = primary,
        tertiary = primary, onTertiary = if(dark) Color(0xFF181818) else Color.White,
        tertiaryContainer = selected, onTertiaryContainer = primary,
        background = bg, onBackground = text, surface = panel, onSurface = text,
        surfaceVariant = if(dark) Color(0xFF303030) else Color(0xFFF3F3F3), onSurfaceVariant = muted,
        surfaceTint = Color.Transparent, outline = controlLine, outlineVariant = line,
        error = error, onError = if(dark) Color(0xFF181818) else Color.White,
        errorContainer = errorSoft, onErrorContainer = error,
        inverseSurface = if(dark) Color(0xFFE8E8E8) else Color(0xFF262626),
        inverseOnSurface = if(dark) Color(0xFF262626) else Color(0xFFF5F5F5),
        surfaceDim = bg, surfaceBright = if(dark) Color(0xFF383838) else Color.White,
        surfaceContainerLowest = bg, surfaceContainerLow = if(dark) Color(0xFF262626) else Color(0xFFF3F3F3),
        surfaceContainer = panel, surfaceContainerHigh = if(dark) Color(0xFF303030) else Color(0xFFEEEEEE),
        surfaceContainerHighest = if(dark) Color(0xFF383838) else Color(0xFFE8E8E8), scrim = Color.Black,
    )
    return MathecaPalette(scheme,
        card = if(dark) Color(0xFF242424) else Color(0xFFFAFAFA),
        menu = if(dark) Color(0xFF383838) else Color(0xFFEEEEEE),
        tagInk = if(dark) Color(0xFFC5C5C5) else Color(0xFF565656),
        tagSurface = if(dark) Color(0xFF363636) else Color(0xFFEDEDED),
        success = if(dark) Color(0xFF93CBA9) else Color(0xFF30664B),
        warning = if(dark) Color(0xFFE8C681) else Color(0xFF886018),
    )
}

internal val LocalMathecaPalette = staticCompositionLocalOf { mathecaPalette(AccentTheme.GRAPHITE, false) }

@Composable internal fun MathecaTheme(accent: AccentTheme, dark: Boolean, content: @Composable () -> Unit) {
    val palette = remember(accent, dark) { mathecaPalette(accent, dark) }
    CompositionLocalProvider(LocalMathecaPalette provides palette) {
        MaterialTheme(colorScheme = palette.scheme, typography = Typography(), content = content)
    }
}
