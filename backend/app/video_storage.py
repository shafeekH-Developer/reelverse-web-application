import concurrent.futures
import json
import os
import random
import shutil
import subprocess
import threading
import time

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError


# ==========================
# Settings
# ==========================

# Quality steps. A video only gets the steps that are SMALLER than its
# own short side (for example a 1080p video gets 360, 480 and 720).
QUALITY_STEPS = [360, 480, 720, 1080, 1440, 2160]

# Formats every browser can play without conversion.
WEB_CODECS = ("h264", "vp8", "vp9", "av1")
WEB_EXTENSIONS = (".mp4", ".m4v", ".mov", ".webm")

MB = 1024 * 1024

# Big uploads are sent in parts. Every part is retried on its own, and
# the upload keeps waiting through short internet or Wi-Fi drops.
PART_SIZE = 16 * MB
PART_WORKERS = 2
PART_ATTEMPTS = 12


# ==========================
# Cloudflare R2
# ==========================

def r2_is_configured():
    names = [
        "R2_ACCOUNT_ID",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_PUBLIC_URL",
    ]

    return all(os.getenv(name) for name in names)


def _client_config(max_attempts=10):
    options = {
        "signature_version": "s3v4",

        # Cloudflare R2 does not need the extra checksums newer boto adds.
        "request_checksum_calculation": "when_required",
        "response_checksum_validation": "when_required",

        # Slow or unstable internet: wait longer and try again more often.
        "connect_timeout": 60,
        "read_timeout": 300,
        "retries": {"max_attempts": max_attempts, "mode": "standard"},
        "tcp_keepalive": True,
    }

    # Older boto versions do not know every option, so drop the newest ones.
    optional = [
        "tcp_keepalive",
        "request_checksum_calculation",
        "response_checksum_validation",
    ]

    while True:
        try:
            return Config(**options)
        except TypeError:
            if not optional:
                raise

            options.pop(optional.pop(0), None)


def _client(max_attempts=10):
    return boto3.client(
        "s3",
        config=_client_config(max_attempts),
        endpoint_url=(
            f"https://{os.getenv('R2_ACCOUNT_ID')}"
            ".r2.cloudflarestorage.com"
        ),
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def public_url(key):
    base = os.getenv("R2_PUBLIC_URL", "").rstrip("/")
    return f"{base}/{key}"


class _UploadProgress:
    # Prints upload progress in the backend terminal for big files.

    def __init__(self, name, total):
        self.name = name
        self.total = total
        self.sent = 0
        self.next_mark = 10
        self.started = time.time()
        self.lock = threading.Lock()

        print(
            f"[ReelVerse] Uploading {name} to R2 "
            f"({total / MB:.0f} MB)...",
            flush=True,
        )

    def __call__(self, amount):
        with self.lock:
            self.sent = max(0, self.sent + amount)

            percent = min(100, int(self.sent * 100 / self.total))

            if percent < self.next_mark:
                return

            self.next_mark = (percent // 10 + 1) * 10

            seconds = max(1, time.time() - self.started)
            speed = self.sent / MB / seconds

            print(
                f"[ReelVerse] {self.name}: {percent}% "
                f"({self.sent / MB:.0f} of {self.total / MB:.0f} MB, "
                f"{speed:.1f} MB/s)",
                flush=True,
            )


def _is_retryable(error):
    # Network problems (dropped connection, SSL error, timeout) and busy
    # server answers are worth trying again. Real errors are not.
    if isinstance(error, BotoCoreError):
        return True

    if isinstance(error, ClientError):
        status = error.response.get(
            "ResponseMetadata", {}
        ).get("HTTPStatusCode", 0)

        code = error.response.get("Error", {}).get("Code", "")

        return (
            status >= 500
            or status == 429
            or code in (
                "RequestTimeout",
                "RequestTimeoutException",
                "SlowDown",
                "Throttling",
            )
        )

    return False


def _with_retries(action, what):
    for attempt in range(1, PART_ATTEMPTS + 1):
        try:
            return action()

        except Exception as error:
            if (
                not _is_retryable(error)
                or attempt == PART_ATTEMPTS
            ):
                raise

            wait = min(60, 2 ** attempt) + random.uniform(0, 1)

            print(
                f"[ReelVerse] {what} failed "
                f"({type(error).__name__}). Trying again in "
                f"{wait:.0f}s (attempt {attempt + 1} of "
                f"{PART_ATTEMPTS})...",
                flush=True,
            )

            time.sleep(wait)


def _upload_in_parts(local_path, key, content_type, size, progress):
    client = _client(max_attempts=3)
    bucket = os.getenv("R2_BUCKET")

    upload = _with_retries(
        lambda: client.create_multipart_upload(
            Bucket=bucket,
            Key=key,
            ContentType=content_type,
            CacheControl="public, max-age=31536000",
        ),
        "Starting the upload",
    )

    upload_id = upload["UploadId"]
    part_count = (size + PART_SIZE - 1) // PART_SIZE
    stop = threading.Event()

    def send_part(number):
        if stop.is_set():
            return None

        try:
            offset = (number - 1) * PART_SIZE
            length = min(PART_SIZE, size - offset)

            with open(local_path, "rb") as file:
                file.seek(offset)
                data = file.read(length)

            response = _with_retries(
                lambda: client.upload_part(
                    Bucket=bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=number,
                    Body=data,
                ),
                f"Part {number} of {part_count}",
            )

            if progress:
                progress(length)

            return {
                "ETag": response["ETag"],
                "PartNumber": number,
            }

        except BaseException:
            # Stop the other parts too, so no time is wasted.
            stop.set()
            raise

    try:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=PART_WORKERS
        ) as pool:
            parts = list(
                pool.map(send_part, range(1, part_count + 1))
            )

        _with_retries(
            lambda: client.complete_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts},
            ),
            "Finishing the upload",
        )

    except BaseException:
        # Clean up the unfinished upload on R2.
        try:
            client.abort_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
            )
        except Exception:
            pass

        raise


def upload_to_r2(local_path, key, content_type):
    size = os.path.getsize(local_path)

    if size < PART_SIZE:

        # Small files go up in a single request.
        with open(local_path, "rb") as file:
            data = file.read()

        client = _client()

        _with_retries(
            lambda: client.put_object(
                Bucket=os.getenv("R2_BUCKET"),
                Key=key,
                Body=data,
                ContentType=content_type,
                CacheControl="public, max-age=31536000",
            ),
            "Upload",
        )

    else:

        progress = None

        if size >= 32 * MB:
            progress = _UploadProgress(os.path.basename(key), size)

        _upload_in_parts(
            local_path,
            key,
            content_type,
            size,
            progress,
        )

    return public_url(key)


def delete_r2_prefix(prefix):
    # Deletes every file inside one video folder.
    client = _client()
    bucket = os.getenv("R2_BUCKET")

    paginator = client.get_paginator("list_objects_v2")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            client.delete_object(Bucket=bucket, Key=item["Key"])


# ==========================
# ffmpeg
# ==========================

def probe_video(path):
    # Returns (width, height, codec) as the viewer sees the video.
    output = subprocess.check_output([
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries",
        "stream=width,height,codec_name:stream_tags=rotate:stream_side_data=rotation",
        "-of", "json",
        path,
    ])

    stream = json.loads(output)["streams"][0]

    width = int(stream["width"])
    height = int(stream["height"])

    rotation = 0

    for side_data in stream.get("side_data_list", []):
        if "rotation" in side_data:
            rotation = int(float(side_data["rotation"]))

    if not rotation:
        rotation = int(float(stream.get("tags", {}).get("rotate", 0)))

    # Phone videos are often stored sideways with a rotation flag.
    if abs(rotation) % 180 == 90:
        width, height = height, width

    return width, height, stream.get("codec_name")


def make_rendition(source_path, output_path, size, landscape):
    # "size" is the short side of the video (720 means 720p).
    if landscape:
        scale = f"scale=-2:{size}"
    else:
        scale = f"scale={size}:-2"

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-loglevel", "error",
            "-i", source_path,
            "-vf", scale,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ],
        check=True,
        capture_output=True,
    )


# ==========================
# Background processing
# ==========================

def start_processing(
    app,
    video_id,
    local_path,
    work_dir,
    key_prefix,
    width,
    height,
    codec,
    extension,
):
    thread = threading.Thread(
        target=_process_video,
        args=(
            app,
            video_id,
            local_path,
            work_dir,
            key_prefix,
            width,
            height,
            codec,
            extension,
        ),
        daemon=True,
    )

    thread.start()


def _process_video(
    app,
    video_id,
    local_path,
    work_dir,
    key_prefix,
    width,
    height,
    codec,
    extension,
):
    from app.extensions import db
    from app.models.video import Video

    with app.app_context():

        try:
            video = db.session.get(Video, video_id)

            short_side = min(width, height)
            landscape = width >= height

            sizes = [s for s in QUALITY_STEPS if s < short_side]

            # If the original is not a browser friendly format, also make
            # a normal H.264 copy at the original size and use it as the
            # main video.
            needs_compat = (
                codec not in WEB_CODECS
                or extension not in WEB_EXTENSIONS
            )

            if needs_compat:
                sizes.append(short_side)

            renditions = []

            for size in sorted(sizes):

                output_path = os.path.join(work_dir, f"{size}p.mp4")

                make_rendition(
                    local_path,
                    output_path,
                    size,
                    landscape,
                )

                url = upload_to_r2(
                    output_path,
                    f"{key_prefix}/{size}p.mp4",
                    "video/mp4",
                )

                os.remove(output_path)

                renditions.append({
                    "height": size,
                    "url": url,
                })

                video.renditions = json.dumps(renditions)

                if needs_compat and size == short_side:
                    video.video_url = url

                db.session.commit()

            video.processing_status = "ready"
            db.session.commit()

        except Exception as error:

            print(f"[ReelVerse] Video processing failed: {error}")

            db.session.rollback()

            video = db.session.get(Video, video_id)

            if video:
                video.processing_status = "failed"
                db.session.commit()

        finally:
            shutil.rmtree(work_dir, ignore_errors=True)