package in.moneybook.app.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class UpdateReleaseTest {

    // Shape of https://api.github.com/repos/harshhaldankar/moneybook/releases/latest (trimmed)
    private static final String RELEASE = "{\"url\":\"https://api.github.com/repos/x/releases/1\","
        + "\"html_url\":\"https://github.com/harshhaldankar/moneybook/releases/tag/v2.1.12\","
        + "\"tag_name\":\"v2.1.12\",\"name\":\"MoneyBook 2.1.12\","
        + "\"assets\":[{\"name\":\"checksums.txt\",\"browser_download_url\":\"https://github.com/x/checksums.txt\"},"
        + "{\"name\":\"MoneyBook.apk\",\"browser_download_url\":\"https://github.com/harshhaldankar/moneybook/releases/download/v2.1.12/MoneyBook.apk\"}],"
        + "\"body\":\"**What's new:** New look: calmer design and a new app icon\\n\\nDownload **MoneyBook.apk** below.\\nBuilt from abc123\"}";

    @Test public void readsVersionBuildApkAndNotes() {
        UpdateRelease r = UpdateRelease.parse(RELEASE);
        assertNotNull(r);
        assertEquals("2.1.12", r.version);
        assertEquals(12L, r.build);
        assertEquals("https://github.com/harshhaldankar/moneybook/releases/download/v2.1.12/MoneyBook.apk", r.url);
        assertEquals("New look: calmer design and a new app icon", r.notes);
    }

    @Test public void fallsBackToReleasePageWithoutApk() {
        UpdateRelease r = UpdateRelease.parse("{\"html_url\":\"https://github.com/x/releases/tag/v2.1.3\",\"tag_name\":\"v2.1.3\",\"assets\":[],\"body\":\"\"}");
        assertNotNull(r);
        assertEquals("https://github.com/x/releases/tag/v2.1.3", r.url);
        assertEquals("", r.notes);
    }

    @Test public void rejectsMissingOrOddTags() {
        assertNull(UpdateRelease.parse("{\"message\":\"Not Found\"}"));
        assertNull(UpdateRelease.parse("{\"tag_name\":\"latest\"}"));
        assertNull(UpdateRelease.parse(null));
    }

    @Test public void unescapesJsonStrings() {
        assertEquals("a \"quoted\" ₹ path/x\nnext", UpdateRelease.unescape("a \\\"quoted\\\" \\u20b9 path\\/x\\nnext"));
    }

    @Test public void notesSkipHeadingsAndDownloadLines() {
        assertEquals("Fix GPay screenshots", UpdateRelease.notesFrom("## Download\n\n- What's new: Fix GPay screenshots"));
    }
}
