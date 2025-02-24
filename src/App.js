import React, { useState, useEffect } from 'react'; // Added useEffect
import Login from './components/Login';
import SignIn from './components/SignIn';
import Chat from './components/Chat';
import './styles.css';
import axios from "axios";


function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [privateKey, setPrivateKey] = useState(localStorage.getItem('privateKey'));
  const [showSignup, setShowSignup] = useState(false);

  // Add effect to log initial state
  useEffect(() => {
    console.log('App mounted');
    console.log('Initial token:', token);
    console.log('Initial privateKey:', privateKey ? 'Present' : 'Not present');
    if (privateKey) {
      console.log('Private key format:', privateKey.substring(0, 50) + '...'); // Show first 50 chars
    }
  }, []);

  const handleLogout = () => {
    console.log('Logging out');
    localStorage.removeItem('token');
    localStorage.removeItem('privateKey');
    setToken(null);
    setPrivateKey(null);
  };

  // Add handlers with logging
  const handleSetToken = (newToken) => {
    console.log('Setting new token:', newToken);
    setToken(newToken);
  };

  const handleSetPrivateKey = (newPrivateKey) => {
    console.log('Setting new private key:', newPrivateKey ? 'Present' : 'Not present');
    if (newPrivateKey) {
      console.log('New private key format:', newPrivateKey.substring(0, 50) + '...');
    }
    setPrivateKey(newPrivateKey);
  };

  const handleSetShowSignup = (value) => {
    console.log('Toggling signup form:', value);
    setShowSignup(value);
  };

  return (
    <div className="App">
      {token ? (
        <div>
          <button onClick={handleLogout}>Logout</button>
          <Chat token={token} privateKey={privateKey} />
        </div>
      ) : showSignup ? (
        <SignIn
          setToken={handleSetToken}
          setPrivateKey={handleSetPrivateKey}
          setShowSignup={handleSetShowSignup}
        />
      ) : (
            <Login
              setToken={handleSetToken}
              setPrivateKey={handleSetPrivateKey} // Add this
              setShowSignup={handleSetShowSignup}
            />
      )}
      
    </div>
  );
}

export default App;