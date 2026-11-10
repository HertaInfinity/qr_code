import os
import io
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from supabase import create_client
import qrcode
from PIL import Image

app = Flask(__name__)

# Initialize Cloud Storage client
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
bucket_name = os.environ.get('BUCKET_NAME')
if not bucket_name:
    raise ValueError("BUCKET_NAME environment variable is required")
bucket = supabase.storage.from_(bucket_name)

@app.route('/')
def health_check():
    """Health check endpoint for Cloud Run"""
    return jsonify({
        'status': 'healthy',
        'service': 'QR Code Generator',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/app')
def frontend():
    return send_from_directory('static', 'index.html')

@app.route('/generate', methods=['POST'])
def generate_qr_code():
    """Generate QR code and store in Cloud Storage"""
    try:
        # Get data from request
        data = request.get_json()
        if not data or 'text' not in data:
            return jsonify({'error': 'Missing text parameter'}), 400
        
        text_to_encode = data['text']
        if len(text_to_encode) > 2000:
            return jsonify({'error': 'Text too long (max 2000 characters)'}), 400
        
        # Generate unique filename
        file_id = str(uuid.uuid4())
        filename = f"qr-{file_id}.png"
        
        # Create QR code with optimal settings
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(text_to_encode)
        qr.make(fit=True)
        
        # Create image
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to bytes
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG', optimize=True)
        img_bytes.seek(0)
        
        # Upload to Cloud Storage with metadata
        bucket.upload(filename, img_bytes.getvalue(), {"content-type": "image/png"})
        public_url = bucket.get_public_url(filename)
        supabase.table("qr_codes").insert({"filename": filename, "text": text_to_encode}).execute()
        
        return jsonify({
            'success': True,
            'qr_code_url': public_url,
            'filename': filename,
            'text_encoded': text_to_encode
        })
        
    except Exception as e:
        app.logger.error(f"Error generating QR code: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/list', methods=['GET'])
def list_qr_codes():
    """List all QR codes in the bucket"""
    try:
        qr_codes = []
        
        for obj in bucket.list():
            name = obj['name']
            if name.startswith('qr-') and name.endswith('.png'):
                qr_codes.append({
                    'filename': name,
                    'url': bucket.get_public_url(name),
                    'created': obj.get('created_at'),
                    'size': (obj.get('metadata') or {}).get('size')
                })
        
        return jsonify({
            'qr_codes': qr_codes,
            'count': len(qr_codes)
        })
        
    except Exception as e:
        app.logger.error(f"Error listing QR codes: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=False, host='0.0.0.0', port=port)
