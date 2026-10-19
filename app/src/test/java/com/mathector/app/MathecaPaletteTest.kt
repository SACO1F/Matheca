package com.mathector.app

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.mathector.app.data.AccentTheme
import com.mathector.app.ui.mathecaPalette
import org.junit.Assert.*
import org.junit.Test

class MathecaPaletteTest {
    private fun contrast(first: Color, second: Color): Float =
        (maxOf(first.luminance(), second.luminance()) + .05f) / (minOf(first.luminance(), second.luminance()) + .05f)

    @Test fun desktopLightTokensRemainTheCrossPlatformContract() {
        val expected = listOf(0xFF252525, 0xFF315A86, 0xFF8A4C38, 0xFF74516D)
        AccentTheme.entries.forEachIndexed { index, accent ->
            val scheme = mathecaPalette(accent, false).scheme
            assertEquals(Color(expected[index]), scheme.primary)
            assertEquals(Color(0xFFF5F5F5), scheme.background)
            assertEquals(Color(0xFF262626), scheme.onSurface)
            assertEquals(Color(0xFF696969), scheme.onSurfaceVariant)
        }
    }

    @Test fun textAndInteractiveStatesStayReadableAcrossAllEightCombinations() {
        for(dark in listOf(false, true)) for(accent in AccentTheme.entries) {
            val p = mathecaPalette(accent, dark)
            val c = p.scheme
            val pairs = listOf(
                c.onSurface to c.background, c.onSurface to c.surface, c.onSurfaceVariant to c.surface,
                c.onSurfaceVariant to c.background, c.onSurfaceVariant to p.card,
                c.onSurface to c.secondaryContainer, c.onSecondaryContainer to c.secondaryContainer,
                c.onPrimary to c.primary, c.onSurface to p.menu, c.onSurfaceVariant to p.menu,
                c.primary to p.menu, p.tagInk to p.tagSurface, c.error to c.errorContainer,
                c.onSurfaceVariant to c.surfaceContainerLow,
                p.success to p.success.copy(alpha = .11f).compositeOver(p.card),
                p.warning to p.warning.copy(alpha = .11f).compositeOver(p.card),
                c.error to c.error.copy(alpha = .11f).compositeOver(p.card),
                c.onPrimary to c.primary.copy(alpha = .96f).compositeOver(c.background),
            )
            pairs.forEach { (text, surface) -> assertTrue("$accent / dark=$dark: $text on $surface", contrast(text, surface) >= 4.5f) }
            assertTrue("Field boundaries remain discernible", contrast(c.outline, c.surface) >= 3f)
            assertNotEquals("Menus are distinct from the reading background", c.background, p.menu)
        }
    }
}
