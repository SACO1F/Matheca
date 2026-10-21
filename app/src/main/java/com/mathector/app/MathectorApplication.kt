package com.mathector.app

import android.app.Application
import android.webkit.WebView
import androidx.room.Room
import com.mathector.app.data.MathectorDatabase
import com.mathector.app.data.SettingsStore
import com.mathector.app.data.CustomKnowledgeStore

class MathectorApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        knowledge.reload()
        WebView.enableSlowWholeDocumentDraw()
    }
    val database: MathectorDatabase by lazy {
        knowledge.reload()
        Room.databaseBuilder(this, MathectorDatabase::class.java, "mathector.db").addMigrations(MathectorDatabase.MIGRATION_1_2, MathectorDatabase.MIGRATION_2_3, MathectorDatabase.MIGRATION_3_4, MathectorDatabase.MIGRATION_4_5, MathectorDatabase.MIGRATION_5_9, MathectorDatabase.MIGRATION_6_9, MathectorDatabase.MIGRATION_7_9, MathectorDatabase.MIGRATION_8_9).build()
    }
    val settings: SettingsStore by lazy { SettingsStore(this) }
    val knowledge: CustomKnowledgeStore by lazy { CustomKnowledgeStore(this) }
}
