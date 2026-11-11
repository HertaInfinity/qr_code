import os
from datetime import datetime, timezone

from flask import Flask, jsonify, send_from_directory

from attendance import bp as attendance_bp

app = Flask(__name__)
app.register_blueprint(attendance_bp)


@app.route('/')
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'QR Attendance API',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })


@app.route('/app')
def frontend():
    return send_from_directory('static', 'index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)