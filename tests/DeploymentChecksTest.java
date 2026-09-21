import java.nio.file.*;
import java.util.zip.*;
import java.io.*;

public class DeploymentChecksTest {
    interface Check { void run() throws Exception; }
    static int checks = 0;
    static void rejects(Check action) throws Exception {
        try { action.run(); } catch (Exception expected) { checks++; return; }
        throw new AssertionError("Expected rejection");
    }
    static void fixture(Path dir, boolean executable) throws Exception {
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(dir.resolve("application.war")))) {
            zip.putNextEntry(new ZipEntry("WEB-INF/classes/App.class"));
            zip.write("demo-class".getBytes()); zip.closeEntry();
            zip.putNextEntry(new ZipEntry("META-INF/MANIFEST.MF"));
            zip.write((executable ? "Manifest-Version: 1.0\r\nMain-Class: org.springframework.boot.loader.launch.WarLauncher\r\nStart-Class: example.App\r\n\r\n" : "Manifest-Version: 1.0\r\n\r\n").getBytes());
            zip.closeEntry();
        }
    }
    static String metadata(String sha) {
        return "{\n\"schemaVersion\":1,\"branch\":\"develop\",\"version\":\"0.1.0-build.12\",\"sha256\":\"" + sha + "\",\"projectId\":\"42\",\"createdAt\":\"2026-09-21T00:00:00.123Z\"}";
    }
    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args[0]); Files.createDirectories(dir);
        fixture(dir, true);
        String sha = DeploymentChecks.digest(dir.resolve("application.war"));
        Files.writeString(dir.resolve("release.json"), metadata(sha));
        DeploymentChecks.checkWar(dir, "0.1.0-build.12", sha, "42"); checks++;
        rejects(() -> DeploymentChecks.checkWar(dir, "0.1.0-build.12", "0".repeat(64), "42"));
        rejects(() -> DeploymentChecks.checkWar(dir, "0.1.0-build.12", sha, "99"));
        rejects(() -> DeploymentChecks.checkWar(dir, "0.1.0-build.13", sha, "42"));
        for (String bad : new String[] {"{\"schemaVersion\":1,\"schemaVersion\":2}", "{\"a\":1,}", "{\"a\":1}junk", "{\"a\":{\"value\":1}}", "{\"a\":01}", "{\"a\":\"unterminated}"}) {
            rejects(() -> DeploymentChecks.manifest(bad));
        }
        fixture(dir, false);
        String plainSha = DeploymentChecks.digest(dir.resolve("application.war"));
        Files.writeString(dir.resolve("release.json"), metadata(plainSha));
        rejects(() -> DeploymentChecks.checkWar(dir, "0.1.0-build.12", plainSha, "42"));
        System.out.println("DeploymentChecks: " + checks + " checks passed");
    }
}
