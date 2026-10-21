package com.mathector.app.data

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import java.util.UUID

@Entity(tableName = "questions")
data class Question(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),
    val title: String = "新题目",
    val body: String = "",
    val latex: String = "",
    val grade: String = "",
    val kind: String = "解答题",
    val difficulty: String = "待评估",
    val knowledge: String = "",
    val sourcePath: String = "",
    val sourceLabel: String = "手动录入",
    val reviewed: Boolean = false,
    val favorite: Boolean = false,
    val example: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(defaultValue = "0") val autoSolve: Boolean = false,
    @ColumnInfo(defaultValue = "''") val solution: String = "",
    @ColumnInfo(defaultValue = "''") val solutionLatex: String = "",
    @ColumnInfo(defaultValue = "''") val solutionFingerprint: String = "",
    @ColumnInfo(defaultValue = "''") val solutionError: String = "",
    @ColumnInfo(defaultValue = "''") val figures: String = "",
    @ColumnInfo(defaultValue = "''") val optionFigures: String = "",
    @ColumnInfo(defaultValue = "'[]'") val figuresJson: String = "[]",
    @ColumnInfo(defaultValue = "'[]'") val figureWidthsJson: String = "[]",
    @ColumnInfo(defaultValue = "'[]'") val figurePlacementsJson: String = "[]",
)

@Entity(tableName = "collections")
data class QuestionCollection(@PrimaryKey val id: String = UUID.randomUUID().toString(), val title: String, val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(defaultValue = "''") val paperTitle: String = "",
    @ColumnInfo(defaultValue = "''") val examInstructions: String = "",
    @ColumnInfo(defaultValue = "0") val examMinutes: Int = 0,
    @ColumnInfo(defaultValue = "0") val totalScore: Int = 0,
    @ColumnInfo(defaultValue = "'{}'") val questionLayoutJson: String = "{}",
)

@Entity(tableName = "collection_items", primaryKeys = ["collectionId", "questionId"],
    foreignKeys = [ForeignKey(entity = QuestionCollection::class, parentColumns = ["id"], childColumns = ["collectionId"], onDelete = ForeignKey.CASCADE),
        ForeignKey(entity = Question::class, parentColumns = ["id"], childColumns = ["questionId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("questionId")])
data class CollectionItem(val collectionId: String, val questionId: String, val position: Int,
    @ColumnInfo(defaultValue = "-1") val solutionSpace: Int = AUTO_SOLUTION_SPACE,
    @ColumnInfo(defaultValue = "0") val newPage: Boolean = false)

@Entity(tableName = "imports")
data class ImportJob(@PrimaryKey val id: String = UUID.randomUUID().toString(), val paths: String,
    val status: String = "queued", val message: String = "等待识别", val createdAt: Long = System.currentTimeMillis())

@Dao
interface MathectorDao {
    @Query("SELECT * FROM questions ORDER BY createdAt DESC") fun questions(): Flow<List<Question>>
    @Query("SELECT * FROM questions ORDER BY createdAt DESC") suspend fun backupQuestions(): List<Question>
    @Query("SELECT * FROM collections ORDER BY createdAt DESC") fun collections(): Flow<List<QuestionCollection>>
    @Query("SELECT * FROM collections ORDER BY createdAt DESC") suspend fun backupCollections(): List<QuestionCollection>
    @Query("SELECT * FROM collection_items ORDER BY position") fun items(): Flow<List<CollectionItem>>
    @Query("SELECT * FROM collection_items ORDER BY position") suspend fun backupItems(): List<CollectionItem>
    @Query("SELECT * FROM imports ORDER BY createdAt DESC") fun imports(): Flow<List<ImportJob>>
    @Query("SELECT * FROM imports WHERE id = :id") suspend fun importJob(id: String): ImportJob?
    @Query("SELECT * FROM questions WHERE id = :id") suspend fun question(id: String): Question?
    @Query("UPDATE collections SET paperTitle = :title, examInstructions = :instructions, examMinutes = :minutes, totalScore = :score WHERE id = :id")
    suspend fun savePaperSettings(id: String, title: String, instructions: String, minutes: Int, score: Int)
    @Upsert suspend fun save(question: Question)
    @Upsert suspend fun save(collection: QuestionCollection)
    @Upsert suspend fun save(job: ImportJob)
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun add(item: CollectionItem)
    @Query("DELETE FROM questions WHERE id = :id") suspend fun deleteQuestion(id: String)
    @Query("DELETE FROM collections WHERE id = :id") suspend fun deleteCollection(id: String)
    @Query("DELETE FROM collection_items WHERE collectionId = :collectionId") suspend fun clearItems(collectionId: String)
    @Query("DELETE FROM collection_items WHERE collectionId = :collectionId AND questionId = :questionId") suspend fun remove(collectionId: String, questionId: String)
    @Query("SELECT COALESCE(MAX(position), -1) + 1 FROM collection_items WHERE collectionId = :collectionId") suspend fun nextPosition(collectionId: String): Int
    @Query("SELECT * FROM collection_items WHERE collectionId = :collectionId ORDER BY position") suspend fun orderedItems(collectionId: String): List<CollectionItem>
    @Query("UPDATE collection_items SET position = :position WHERE collectionId = :collectionId AND questionId = :questionId") suspend fun setPosition(collectionId: String, questionId: String, position: Int)
    @Query("UPDATE collection_items SET solutionSpace = :space, newPage = :newPage WHERE collectionId = :collectionId AND questionId = :questionId")
    suspend fun setItemLayout(collectionId: String, questionId: String, space: Int, newPage: Boolean)
    @Transaction suspend fun saveSolution(id: String, fingerprint: String, result: SolutionResult?, error: String = ""): Boolean {
        val current = question(id) ?: return false
        if (current.contentFingerprint() != fingerprint) return false
        save(current.copy(solution = result?.formatted ?: current.solution, solutionLatex = result?.latex ?: current.solutionLatex,
            solutionFingerprint = if(result != null) fingerprint else current.solutionFingerprint, solutionError = error))
        return true
    }
    @Transaction suspend fun move(collectionId: String, questionId: String, delta: Int) {
        val items = orderedItems(collectionId).toMutableList()
        val from = items.indexOfFirst { it.questionId == questionId }
        val to = from + delta
        if (from < 0 || to !in items.indices) return
        val moved = items.removeAt(from); items.add(to, moved)
        items.forEachIndexed { i, item -> setPosition(collectionId, item.questionId, i) }
    }
    @Transaction suspend fun addToCollection(collectionId: String, questionId: String) { add(CollectionItem(collectionId, questionId, nextPosition(collectionId))) }
    @Transaction suspend fun addQuestions(collectionId: String, questionIds: List<String>): Int {
        val existing = orderedItems(collectionId).map { it.questionId }.toSet()
        var position = nextPosition(collectionId)
        var count = 0
        questionIds.distinct().filter { it !in existing }.forEach { id ->
            if(question(id) != null) { add(CollectionItem(collectionId, id, position++)); count++ }
        }
        return count
    }
}

@Database(entities = [Question::class, QuestionCollection::class, CollectionItem::class, ImportJob::class], version = 9, exportSchema = true)
abstract class MathectorDatabase : RoomDatabase() {
    abstract fun dao(): MathectorDao
    companion object {
        val MIGRATION_6_7 = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE questions ADD COLUMN optionFigures TEXT NOT NULL DEFAULT ''")
            }
        }
        val MIGRATION_5_6 = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE collection_items ADD COLUMN solutionSpace INTEGER NOT NULL DEFAULT -1")
                db.execSQL("ALTER TABLE collection_items ADD COLUMN newPage INTEGER NOT NULL DEFAULT 0")
            }
        }
        val MIGRATION_5_9 = LegacyDatabaseMigration.from(5)
        val MIGRATION_6_9 = LegacyDatabaseMigration.from(6)
        val MIGRATION_7_9 = LegacyDatabaseMigration.from(7)
        val MIGRATION_8_9 = LegacyDatabaseMigration.from(8)
        val MIGRATION_4_5 = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                listOf("figuresJson", "figureWidthsJson", "figurePlacementsJson").forEach { db.execSQL("ALTER TABLE questions ADD COLUMN $it TEXT NOT NULL DEFAULT '[]'") }
                db.execSQL("ALTER TABLE collections ADD COLUMN questionLayoutJson TEXT NOT NULL DEFAULT '{}'")
            }
        }
        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE collections ADD COLUMN paperTitle TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE collections ADD COLUMN examInstructions TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE collections ADD COLUMN examMinutes INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE collections ADD COLUMN totalScore INTEGER NOT NULL DEFAULT 0")
                db.execSQL("UPDATE collections SET paperTitle = substr(trim(title), 1, 80)")
                normalizeBodies(db)
            }
        }
        private fun normalizeBodies(db: SupportSQLiteDatabase) {
            val changes = mutableListOf<Question>()
            db.query("SELECT id, title, body, latex, sourcePath, solutionFingerprint FROM questions").use { cursor ->
                while(cursor.moveToNext()) {
                    val old = Question(id = cursor.getString(0), title = cursor.getString(1), body = cursor.getString(2), latex = cursor.getString(3), sourcePath = cursor.getString(4), solutionFingerprint = cursor.getString(5))
                    val clean = QuestionText.normalize(old)
                    changes += clean.copy(solutionFingerprint = if(old.solutionFingerprint == old.contentFingerprint()) clean.contentFingerprint() else old.solutionFingerprint)
                }
            }
            changes.forEach { q -> db.execSQL("UPDATE questions SET title = ?, body = ?, solutionFingerprint = ? WHERE id = ?", arrayOf(q.title, q.body, q.solutionFingerprint, q.id)) }
        }
        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                normalizeBodies(db)
            }
        }
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE questions ADD COLUMN autoSolve INTEGER NOT NULL DEFAULT 0")
                listOf("solution", "solutionLatex", "solutionFingerprint", "solutionError").forEach { db.execSQL("ALTER TABLE questions ADD COLUMN $it TEXT NOT NULL DEFAULT ''") }
                db.execSQL("UPDATE questions SET grade = '' WHERE grade NOT IN ('高一', '高二', '高三')")
                val changes = mutableListOf<Pair<String, String>>()
                db.query("SELECT id, knowledge FROM questions").use { cursor -> while(cursor.moveToNext()) changes += cursor.getString(0) to KnowledgeCatalog.normalize(cursor.getString(1)) }
                changes.forEach { (id, knowledge) -> db.execSQL("UPDATE questions SET knowledge = ? WHERE id = ?", arrayOf(knowledge, id)) }
            }
        }
    }
}

object Classification {
    data class Suggestion(val grade: String, val knowledge: String, val kind: String)
    fun suggest(text: String): Suggestion {
        val detected = KnowledgeCatalog.points.filter { text.contains(it) }.toMutableList()
        val hints = mapOf("导数" to "导数概念与运算", "单调" to "函数单调性", "奇偶" to "函数奇偶性", "对数" to "对数函数", "指数" to "指数函数", "等差" to "等差数列", "等比" to "等比数列", "椭圆" to "椭圆", "双曲线" to "双曲线", "抛物线" to "抛物线", "二项分布" to "二项分布", "概率" to "随机事件与概率", "集合" to "集合的概念", "sin" to "三角函数定义", "cos" to "三角函数定义", "向量" to "平面向量概念")
        hints.forEach { (word, point) -> if(text.contains(word, true)) detected += point }
        val topic = KnowledgeCatalog.encode(detected.distinct())
        val grade = KnowledgeCatalog.grades.firstOrNull { text.contains(it) }.orEmpty()
        val kind = when { Regex("[ABCD][.．、)]").containsMatchIn(text) -> "选择题"; text.contains("填空") || text.contains("___") -> "填空题"; text.contains("证明") -> "证明题"; else -> "解答题" }
        return Suggestion(grade, topic, kind)
    }
}

object QuestionSplitter {
    private val marker = Regex("^\\s*[1-9]\\d?\\s*[.．、](?!\\d)\\s*\\S")
    fun split(text: String): List<String> {
        val groups = mutableListOf<StringBuilder>()
        text.lines().map(String::trim).filter(String::isNotEmpty).forEach { line ->
            if (groups.isEmpty() || marker.containsMatchIn(line)) groups += StringBuilder()
            if (groups.last().isNotEmpty()) groups.last().append('\n')
            groups.last().append(line)
        }
        return groups.map { it.toString() }.filter(String::isNotBlank)
    }
}
