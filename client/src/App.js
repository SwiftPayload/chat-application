// client/src/App.js - Main client entry point

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Provider } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './contexts/ThemeContext';
import store from './store';

// Authentication Components
import Login from './pages/Login';
import Register from './pages/Register';
import PrivateRoute from './components/PrivateRoute';

// Main App Components
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import TextChannel from './pages/TextChannel';
import VoiceChannel from './pages/VoiceChannel';
import UserSettings from './pages/UserSettings';
import ChannelSettings from './pages/ChannelSettings';

// Utilities
import { initializeSocketConnection } from './utils/socket';
import { refreshToken } from './services/authService';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing auth token and validate it
    const token = localStorage.getItem('token');
    if (token) {
      refreshToken()
        .then(() => {
          setIsAuthenticated(true);
          initializeSocketConnection();
        })
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          setIsAuthenticated(false);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <Provider store={store}>
      <ThemeProvider>
        <Router>
          <Toaster position="top-right" />
          <Routes>
            <Route path="/login" element={!isAuthenticated ? <Login setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/" />} />
            <Route path="/register" element={!isAuthenticated ? <Register setIsAuthenticated={setIsAuthenticated} /> : <Navigate to="/" />} />
            
            {/* Private Routes */}
            <Route path="/" element={<PrivateRoute isAuthenticated={isAuthenticated}><MainLayout /></PrivateRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="channels/:channelId" element={<TextChannel />} />
              <Route path="voice/:channelId" element={<VoiceChannel />} />
              <Route path="settings" element={<UserSettings />} />
              <Route path="channels/:channelId/settings" element={<ChannelSettings />} />
            </Route>
          </Routes>
        </Router>
      </ThemeProvider>
    </Provider>
  );
}

export default App;
