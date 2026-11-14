package in.moneybook.app.update;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the GitHub "latest release" JSON. Plain Java on purpose so it runs in JVM unit tests.
 * Release tags are v2.1.&lt;build&gt;, and the build number is the APK's versionCode.
 * Mirrors Native.checkForUpdate in js/native.js, so the notification and the in-app banner agree.
 */
public final class UpdateRelease {
    public final String version;   // "2.1.12"
    public final long build;       // 12
    public final String notes;     // first line of "What's new", or ""
    public final String url;       // APK download, or the release page

    private UpdateRelease(String version, long build, String notes, String url) {
        this.version = version; this.build = build; this.notes = notes; this.url = url;
    }

    /** Returns null when the JSON has no usable tag. */
    public static UpdateRelease parse(String json) {
        if (json == null) return null;
        String tag = stringField(json, "tag_name");
        if (tag == null) return null;
        long build;
        try { build = Long.parseLong(tag.substring(tag.lastIndexOf('.') + 1).trim()); }
        catch (NumberFormatException e) { return null; }

        String url = null;
        Matcher m = Pattern.compile("\"browser_download_url\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        while (m.find()) {
            String u = unescape(m.group(1));
            if (u.toLowerCase().endsWith(".apk")) { url = u; break; }
        }
        if (url == null) url = stringField(json, "html_url");
        String version = tag.startsWith("v") ? tag.substring(1) : tag;
        return new UpdateRelease(version, build, notesFrom(stringField(json, "body")), url);
    }

    /** First meaningful line of the release text, without markdown or the "What's new:" prefix. */
    static String notesFrom(String body) {
        if (body == null) return "";
        for (String line : body.split("\n")) {
            String l = line.replaceAll("^[#*\\s-]+|\\*\\*", "").trim();
            if (l.isEmpty() || l.toLowerCase().matches("^(download|built from).*")) continue;
            return l.replaceFirst("(?i)^What's new:\\s*", "");
        }
        return "";
    }

    /** Value of a top-level-looking string field ("key": "value"); first match wins. */
    static String stringField(String json, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
        return m.find() ? unescape(m.group(1)) : null;
    }

    static String unescape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { out.append(c); continue; }
            char n = s.charAt(++i);
            switch (n) {
                case 'n': out.append('\n'); break;
                case 'r': out.append('\r'); break;
                case 't': out.append('\t'); break;
                case 'b': out.append('\b'); break;
                case 'f': out.append('\f'); break;
                case 'u':
                    if (i + 4 < s.length()) {
                        try { out.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16)); i += 4; break; }
                        catch (NumberFormatException ignored) { /* fall through to literal */ }
                    }
                    out.append(n); break;
                default: out.append(n);   // \" \\ \/
            }
        }
        return out.toString();
    }
}
