import React from 'react';

const ConnectionStatus = ({ status }) => {
  let indicatorClass = '';
  
  if (status.state === 'online') {
    indicatorClass = 'online';
  } else if (status.state === 'offline') {
    indicatorClass = 'offline';
  } else {
    indicatorClass = 'connecting'; // Custom CSS class logic if needed, fallback to default
  }

  return (
    <div className={`status-indicator ${indicatorClass}`} id="backend-status">
      <span className="status-dot"></span>
      <span className="status-text">{status.message}</span>
    </div>
  );
};

export default ConnectionStatus;
