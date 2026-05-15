import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// This debug route is no longer needed — the canvas board handles all chunks.
const SingleChunkPage: React.FC = () => {
  const navigate = useNavigate();
  useEffect(() => { navigate('/'); }, [navigate]);
  return null;
};

export default SingleChunkPage;
