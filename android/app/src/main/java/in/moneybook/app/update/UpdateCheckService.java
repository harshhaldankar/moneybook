package in.moneybook.app.update;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import in.moneybook.app.R;

/**
 * Checks GitHub for a newer MoneyBook release a few times a day, in the background,
 * and posts one notification per new version. Tapping it opens the APK download.
 * Uses only the platform JobScheduler: no extra libraries, no data leaves the phone
 * (it only reads the public releases page of the app's own repository).
 */
public class UpdateCheckService extends JobService {
    private static final int JOB_ID = 4201;
    private static final int NOTIFICATION_ID = 4202;
    private static final String CHANNEL_ID = "updates";
    private static final String PREFS = "mb_update";
    private static final String KEY_NOTIFIED = "notified_build";
    private static final long EVERY_MS = 6L * 60 * 60 * 1000;

    /** Called from MainActivity on every launch; does nothing if the job is already scheduled. */
    public static void schedule(Context context) {
        JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        for (JobInfo job : js.getAllPendingJobs()) {
            if (job.getId() == JOB_ID) return;
        }
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UpdateCheckService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(EVERY_MS)
            .setPersisted(true)
            .build();
        try { js.schedule(job); } catch (RuntimeException ignored) { /* scheduling is best effort */ }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { check(getApplicationContext()); } catch (Exception ignored) { /* try again next time */ }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;   // reschedule if the system stopped us early
    }

    private static void check(Context context) throws Exception {
        String repo = context.getString(R.string.update_repo);
        if (repo.isEmpty()) return;
        UpdateRelease latest = UpdateRelease.parse(fetch("https://api.github.com/repos/" + repo + "/releases/latest"));
        if (latest == null || latest.url == null) return;

        long installed = installedBuild(context);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (latest.build <= installed || latest.build <= prefs.getLong(KEY_NOTIFIED, 0)) return;

        if (notify(context, latest)) prefs.edit().putLong(KEY_NOTIFIED, latest.build).apply();
    }

    private static String fetch(String address) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "MoneyBook-Android");
        try {
            if (conn.getResponseCode() != 200) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        } finally {
            conn.disconnect();
        }
    }

    @SuppressWarnings("deprecation")
    private static long installedBuild(Context context) throws PackageManager.NameNotFoundException {
        PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    /** Returns false when notifications are turned off, so we try again after the user allows them. */
    @SuppressWarnings("deprecation")
    private static boolean notify(Context context, UpdateRelease latest) {
        if (Build.VERSION.SDK_INT >= 33
            && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("When a new version of MoneyBook is ready to install");
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(latest.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String body = latest.notes.isEmpty() ? "Tap to download and install" : latest.notes;
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);
        b.setSmallIcon(R.drawable.ic_stat_moneybook)
            .setColor(0xFF2340A8)
            .setContentTitle("MoneyBook " + latest.version + " is ready")
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body + "\nTap to download and install."))
            .setContentIntent(tap)
            .setAutoCancel(true);
        nm.notify(NOTIFICATION_ID, b.build());
        return true;
    }
}
