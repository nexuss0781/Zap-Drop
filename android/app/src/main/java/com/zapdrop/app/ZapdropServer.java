package com.zapdrop.app;

import android.content.Context;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.FileInputStream;
import java.io.BufferedInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

public class ZapdropServer extends NanoHTTPD {

    public interface Events {
        void onProgress(String id, long bytes, long total);
        void onDone(String peerIp);
    }

    private final Context ctx;
    private final String token;
    private final Events events;
    private final Map<String, JSONObject> files = new HashMap<>();
    private final JSONArray manifest = new JSONArray();

    public ZapdropServer(Context ctx, int port, String token, JSArray arr, Events ev) throws Exception {
        super(port);
        this.ctx = ctx;
        this.token = token;
        this.events = ev;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject f = arr.getJSONObject(i);
            files.put(f.getString("id"), f);
            manifest.put(f);
        }
    }

    @Override
    public Response serve(IHTTPSession s) {
        String t = s.getParms().get("t");
        if (t == null || !t.equals(token)) {
            return text(Response.Status.FORBIDDEN, "forbidden");
        }

        String uri = s.getUri();

        if (uri.equals("/manifest")) {
            try {
                JSONObject response = new JSONObject();
                response.put("files", manifest);
                return newFixedLengthResponse(Response.Status.OK, "application/json", response.toString());
            } catch (Exception e) {
                return text(Response.Status.INTERNAL_ERROR, e.getMessage());
            }
        }

        if (uri.equals("/done")) {
            events.onDone(s.getHeaders().get("remote-addr"));
            return text(Response.Status.OK, "ok");
        }

        if (uri.startsWith("/file/")) {
            String id = uri.substring(6);
            JSONObject f = files.get(id);
            if (f == null) {
                return text(Response.Status.NOT_FOUND, "not found");
            }
            try {
                Uri u = Uri.parse(f.getString("uri"));
                ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(u, "r");
                if (pfd == null) {
                    return text(Response.Status.NOT_FOUND, "file descriptor unavailable");
                }
                long reportedSize = pfd.getStatSize();
                final long total = reportedSize > 0 ? reportedSize : f.optLong("size", 0L);
                if (total <= 0) {
                    pfd.close();
                    return text(Response.Status.INTERNAL_ERROR, "File size is unavailable");
                }
                FileInputStream rawIn = new FileInputStream(pfd.getFileDescriptor());

                long start = 0;
                String range = s.getHeaders().get("range");
                if (range != null && range.startsWith("bytes=")) {
                    start = Long.parseLong(range.substring(6).split("-")[0]);
                    rawIn.getChannel().position(start);
                }
                InputStream in = new BufferedInputStream(rawIn, 256 * 1024);
                final long from = start;
                InputStream counting = new FilterInputStream(in) {
                    long sent = from;
                    @Override
                    public int read(byte[] b, int o, int l) throws IOException {
                        int n = super.read(b, o, l);
                        if (n > 0) {
                            sent += n;
                            events.onProgress(id, sent, total);
                        }
                        return n;
                    }
                    @Override
                    public void close() throws IOException {
                        super.close();
                        pfd.close();
                    }
                };

                Response r = newFixedLengthResponse(
                    start > 0 ? Response.Status.PARTIAL_CONTENT : Response.Status.OK,
                    f.getString("mime"),
                    counting,
                    total - start
                );
                r.addHeader("Accept-Ranges", "bytes");
                r.addHeader("Content-Disposition", "attachment; filename=\"" + f.getString("name") + "\"");
                if (start > 0) {
                    r.addHeader("Content-Range", "bytes " + start + "-" + (total - 1) + "/" + total);
                }
                return r;
            } catch (Exception e) {
                return text(Response.Status.INTERNAL_ERROR, e.getMessage());
            }
        }
        return text(Response.Status.NOT_FOUND, "not found");
    }

    private Response text(Response.IStatus st, String m) {
        return newFixedLengthResponse(st, "text/plain", m);
    }
}
