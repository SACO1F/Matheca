package com.mathector.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.mathector.app.data.QuestionCollection

/** The same collection surface is used when opening a collection and when selecting it for exchange. */
@Composable internal fun CollectionSummaryCard(collection: QuestionCollection, count: Int, onClick: () -> Unit,
    modifier: Modifier = Modifier, selected: Boolean? = null, enabled: Boolean = true,
    trailing: (@Composable RowScope.() -> Unit)? = null) {
    val interaction=remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if(pressed) .98f else 1f,spring(dampingRatio=.74f,stiffness=450f),label="collection-press")
    val fill by animateColorAsState(if(selected==true) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,tween(160),label="collection-fill")
    val shape=RoundedCornerShape(24.dp)
    val stackActions=selected==null && LocalDensity.current.fontScale>1.3f
    val click=if(selected==null) Modifier.clickable(enabled=enabled,interactionSource=interaction,indication=null,role=Role.Button,onClick=onClick)
        else Modifier.toggleable(selected,enabled=enabled,interactionSource=interaction,indication=null,role=Role.Checkbox,onValueChange={onClick()})
    Column(modifier.fillMaxWidth().heightIn(min=80.dp).scale(scale).clip(shape).background(fill)
        .then(if(selected==true) Modifier.border(1.dp,MaterialTheme.colorScheme.primary.copy(alpha=.6f),shape) else Modifier)
        .then(click).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
        Icon(Icons.Rounded.FolderOpen,null,tint=MaterialTheme.colorScheme.primary,modifier=Modifier.size(32.dp))
        Column(Modifier.weight(1f).padding(horizontal=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(collection.title,fontSize=17.sp,fontWeight=FontWeight.SemiBold)
            Text("$count 道题",Modifier.testTag("collection-description-${collection.id}"),fontSize=12.sp,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if(selected!=null) {
            Box(Modifier.size(24.dp).clip(CircleShape).background(if(selected) MaterialTheme.colorScheme.primary else Color.Transparent)
                .border(1.5.dp,if(selected) Color.Transparent else MaterialTheme.colorScheme.onSurface.copy(alpha=.28f),CircleShape),contentAlignment=Alignment.Center) {
                if(selected) Icon(Icons.Rounded.Check,null,Modifier.size(16.dp),tint=MaterialTheme.colorScheme.onPrimary)
            }
        } else if(!stackActions) trailing?.invoke(this)
        }
        if(stackActions && trailing!=null) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End) { trailing.invoke(this) }
    }
}
