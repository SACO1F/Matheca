package com.mathector.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset

/** Move the whole page across a stable viewport; the tab bar stays in place. */
@Composable internal fun DesktopLinkPages(selected: Int,modifier: Modifier=Modifier,content: @Composable (Int)->Unit) {
    AnimatedContent(selected,modifier=modifier.clipToBounds(),transitionSpec={
        val direction=if(targetState>initialState) AnimatedContentTransitionScope.SlideDirection.Left else AnimatedContentTransitionScope.SlideDirection.Right
        (slideIntoContainer(direction,tween(300)) togetherWith slideOutOfContainer(direction,tween(300))).using(null)
    },label="link-page-slide") { page ->
        Box(Modifier.fillMaxSize().testTag("desktop-link-page-$page")) {content(page)}
    }
}

/** Uses the library navigation's spring/press/color feedback and the native app's surface roles. */
@Composable internal fun DesktopLinkTabs(selected: Int,onSelect: (Int)->Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal=22.dp,vertical=8.dp).clip(RoundedCornerShape(28.dp))
        .background(MaterialTheme.colorScheme.surface).padding(4.dp)) {
        val cell=(maxWidth-8.dp)/3
        val position by animateDpAsState((cell+4.dp)*selected,spring(dampingRatio=.84f,stiffness=420f),label="link-tab-slide")
        Box(Modifier.matchParentSize()) {
            Box(Modifier.offset {IntOffset(position.roundToPx(),0)}.width(cell).fillMaxHeight().clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.primary.copy(alpha=.10f)).testTag("link-tab-indicator"))
        }
        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).selectableGroup(),horizontalArrangement=Arrangement.spacedBy(4.dp)) {
        listOf("连接与待传","选择资料","接收题库").forEachIndexed { index,title ->
            val interaction=remember { MutableInteractionSource() }; val pressed by interaction.collectIsPressedAsState()
            val scale by animateFloatAsState(if(pressed) .95f else 1f,spring(dampingRatio=.78f,stiffness=450f),label="link-tab-press")
            val color by animateColorAsState(if(selected==index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,tween(180),label="link-tab-ink")
            Text(title,Modifier.weight(1f).fillMaxHeight().heightIn(min=48.dp).scale(scale).clip(RoundedCornerShape(24.dp)).testTag("link-tab-$index")
                .selectable(selected==index,interactionSource=interaction,indication=null,role=Role.Tab,onClick={onSelect(index)})
                .padding(horizontal=4.dp,vertical=14.dp),fontSize=13.sp,fontWeight=if(selected==index) FontWeight.SemiBold else FontWeight.Normal,
                color=color,textAlign=TextAlign.Center)
        }
    }
    }
}

@Composable internal fun DesktopLinkPanel(content: @Composable ColumnScope.()->Unit) {
    Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surface,modifier=Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)
    }
}
