import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.jar.Manifest;
import java.util.regex.*;
import java.util.zip.*;

/** JDK 17 only. Checks the flat release manifest produced by our pipeline. */
public final class DeploymentChecks {
    // The release schema has only token strings, ISO timestamps and integer IDs.
    // Escapes, nested objects/arrays and duplicate keys are deliberately rejected.
    private static final Pattern FIELD = Pattern.compile(
        "\\s*\"([A-Za-z][A-Za-z0-9]*)\"\\s*:\\s*(?:\"([A-Za-z0-9_.:+-]*)\"|(-?(?:0|[1-9][0-9]*)))\\s*([,}])");
    private static final Pattern HEALTH = Pattern.compile(
        "\\s*\\{\\s*\"value\"\\s*:\\s*-?(?:0|[1-9][0-9]*)\\s*}\\s*");

    static Map<String, Object> manifest(String text) {
        text = text.trim();
        if (!text.startsWith("{")) throw new IllegalArgumentException("Invalid release JSON");
        Map<String, Object> result = new HashMap<>();
        int pos = 1;
        while (pos < text.length()) {
            Matcher m = FIELD.matcher(text).region(pos, text.length());
            if (!m.lookingAt()) throw new IllegalArgumentException("Unsupported release JSON field");
            Object value = m.group(2) != null ? m.group(2) : Long.valueOf(m.group(3));
            if (result.putIfAbsent(m.group(1), value) != null)
                throw new IllegalArgumentException("Duplicate release key");
            pos = m.end();
            if (m.group(4).equals("}")) {
                if (pos != text.length()) throw new IllegalArgumentException("Trailing JSON data");
                return result;
            }
        }
        throw new IllegalArgumentException("Incomplete release JSON");
    }

    static String digest(Path file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(file)) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    static void checkWar(Path folder, String version, String expected, String project) throws Exception {
        if (!expected.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid expected SHA-256");
        Path war = folder.resolve("application.war");
        if (!digest(war).equals(expected)) throw new IllegalArgumentException("Staged WAR checksum mismatch");
        Map<String, Object> data = manifest(Files.readString(folder.resolve("release.json")));
        if (!Long.valueOf(1).equals(data.get("schemaVersion")) || !"develop".equals(data.get("branch")) ||
            !version.equals(data.get("version")) || !expected.equals(data.get("sha256")) ||
            !project.equals(String.valueOf(data.get("projectId"))))
            throw new IllegalArgumentException("Release version/checksum/project mismatch");
        try (ZipFile zip = new ZipFile(war.toFile())) {
            ZipEntry manifest = zip.getEntry("META-INF/MANIFEST.MF");
            if (manifest == null) throw new IllegalArgumentException("Missing WAR manifest");
            try (InputStream input = zip.getInputStream(manifest)) {
                var attrs = new Manifest(input).getMainAttributes();
                String main = attrs.getValue("Main-Class");
                String start = attrs.getValue("Start-Class");
                if (!("org.springframework.boot.loader.launch.WarLauncher".equals(main) ||
                      "org.springframework.boot.loader.WarLauncher".equals(main)) || start == null || start.isBlank())
                    throw new IllegalArgumentException("Executable Spring Boot WAR required");
            }
            boolean classes = false;
            for (var entries = zip.entries(); entries.hasMoreElements();) {
                ZipEntry entry = entries.nextElement();
                classes |= entry.getName().startsWith("WEB-INF/classes/");
                CRC32 crc = new CRC32();
                try (InputStream input = zip.getInputStream(entry)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) crc.update(buffer, 0, count);
                }
                if (crc.getValue() != entry.getCrc()) throw new IllegalArgumentException("Corrupt WAR entry");
            }
            if (!classes) throw new IllegalArgumentException("WAR has no application classes");
        }
    }

    public static void main(String[] args) {
        try {
            if (args.length == 1 && args[0].equals("health")) {
                byte[] body = System.in.readNBytes(65537);
                if (body.length > 65536 || !HEALTH.matcher(new String(body, StandardCharsets.UTF_8)).matches())
                    throw new IllegalArgumentException("Expected counter JSON with integer value");
            } else if (args.length == 5 && args[0].equals("war")) {
                checkWar(Path.of(args[1]), args[2], args[3], args[4]);
                System.out.println("Staged WAR and manifest verified.");
            } else {
                throw new IllegalArgumentException("Usage: health | war folder version sha256 projectId");
            }
        } catch (Exception error) {
            System.err.println("ERROR: " + error.getMessage());
            System.exit(1);
        }
    }
}
