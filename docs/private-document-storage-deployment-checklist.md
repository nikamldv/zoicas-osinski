# Private document storage deployment checklist

Complete this check after approval, before accepting production traffic.

1. Identify the account and execution environment used by the web service. Resolve the configured `PRIVATE_DOCUMENT_UPLOAD_DIR` from that environment, including any service sandbox or container mount. Keep private paths in restricted deployment records.
2. Confirm that the resolved directory is the intended private volume and is outside the web server's static roots. Check available space, applicable quotas, and whether the volume is mounted read-write.
3. From the same account and execution environment, perform an exclusive create, write, readback, and delete of a uniquely named synthetic file in the configured directory. Use create-exclusive mode (`wx` in Node.js) and remove only the file created by the probe. If the directory is absent, stop and confirm the intended location with the service owner.
4. Confirm that the service's stderr is collected in restricted logs. Verify in staging that a denied write produces `DOCUMENT_UPLOAD_STORAGE_ERROR` with a UTC timestamp, an upload correlation UUID, an error code, an operation, and the logical storage name. The response should remain generic.
5. Record the result and stop on failure. Obtain approval before changing permissions, ownership, mounts, or service configuration. Repeat the probe after any approved change.
