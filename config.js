window.API_URL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api'
    : 'https://jwt-backend-p42s.onrender.com/api';
