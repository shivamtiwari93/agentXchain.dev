import axios from 'axios';

const api = axios.create({
  baseURL: '/api', // We will proxy this in vite.config.ts
  withCredentials: true,
});

export default api;
