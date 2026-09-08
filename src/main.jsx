import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/vazirmatn';
import './styles/global.scss';
import './styles/shop.scss';
import App from './App';
import { ContentProvider } from './content/ContentContext';
import { ShopProvider } from './shop/ShopContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ContentProvider>
      <ShopProvider>
        <App />
      </ShopProvider>
    </ContentProvider>
  </React.StrictMode>
);
