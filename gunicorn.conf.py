"""Production process settings for Linux/Docker hosting."""

import os

bind = f"0.0.0.0:{int(os.environ.get('PORT', '10000'))}"
# PyMuPDF must not handle requests concurrently in multiple threads.
worker_class = 'sync'
threads = 1
workers = max(1, int(os.environ.get('WEB_CONCURRENCY', '1')))
timeout = max(30, int(os.environ.get('GUNICORN_TIMEOUT', '300')))
graceful_timeout = 30
max_requests = 100
max_requests_jitter = 20
accesslog = '-'
errorlog = '-'
capture_output = True
