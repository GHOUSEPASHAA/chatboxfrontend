import React, { useState } from 'react';
import axios from 'axios';

function Signup({ setToken, setPrivateKey, setShowSignup }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [location, setLocation] = useState('');
  const [designation, setDesignation] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://localhost:3000/api/signup', {
        name,
        email,
        password,
        location,
        designation,
      });
      const { token, privateKey } = res.data;

      localStorage.setItem('token', token);
      localStorage.setItem('privateKey', privateKey);
      setToken(token);
      setPrivateKey(privateKey);
      setShowSignup(false);

      console.log('Signup successful, token:', token);
      console.log('Private key:', privateKey.substring(0, 50) + '...');
    } catch (error) {
      console.error('Signup error:', error.response?.data || error.message);
    }
  };

  return (
    <div>
      <h2>Signup</h2>
      <form onSubmit={handleSubmit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location"
          required
        />
        <input
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="Designation"
          required
        />
        <button type="submit">Signup</button>
      </form>
      <button onClick={() => setShowSignup(false)}>Back to Login</button>
    </div>
  );
}

export default Signup;