import { useState, useEffect, useCallback, useRef } from 'react';
import { Coordinates, ViewportState } from '../types';

interface UseViewportProps {
  initialCenter?: Coordinates;
  initialWidth?: number;
  initialHeight?: number;
  initialZoom?: number;
  onViewportChange?: (viewport: ViewportState) => void;
}

interface UseViewportReturn {
  viewport: ViewportState;
  isPanning: boolean;
  worldToViewportCoordinates: (worldX: number, worldY: number) => { x: number, y: number } | null;
  viewportToWorldCoordinates: (viewportX: number, viewportY: number) => { x: number, y: number };
  handlePanStart: (clientX: number, clientY: number) => void;
  handlePanMove: (clientX: number, clientY: number) => void;
  handlePanEnd: () => void;
  handleKeyboardPan: (direction: 'up' | 'down' | 'left' | 'right') => void;
  setCenterPosition: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
}

/**
 * Custom hook to manage viewport state and panning in the infinite world
 */
export function useViewport({
  initialCenter = { x: 0, y: 0 },
  initialWidth = 20,
  initialHeight = 15,
  initialZoom = 1,
  onViewportChange
}: UseViewportProps = {}): UseViewportReturn {
  // Main viewport state
  const [viewport, setViewport] = useState<ViewportState>({
    center: initialCenter,
    width: initialWidth,
    height: initialHeight,
    zoom: initialZoom
  });

  // Panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  
  // Use a ref to store the previous center position to avoid unnecessary updates
  const prevCenterRef = useRef<Coordinates>(initialCenter);
  
  // Keyboard pan amount in cells (adjust as needed)
  const KEYBOARD_PAN_AMOUNT = 3;
  // Pixels per cell for pan calculations
  const CELL_SIZE = 30;

  // Update the viewport state
  const updateViewport = useCallback((newViewport: Partial<ViewportState>) => {
    setViewport(prev => {
      const updated = { ...prev, ...newViewport };
      
      // Only trigger onViewportChange if the center position has actually changed
      if (onViewportChange && 
          (prev.center.x !== updated.center.x || 
           prev.center.y !== updated.center.y ||
           prev.width !== updated.width ||
           prev.height !== updated.height ||
           prev.zoom !== updated.zoom)) {
        
        // We don't need to call the callback for every tiny movement during a pan
        // Only trigger the callback if we're not actively panning OR if center changed significantly
        if (!isPanning || 
            Math.abs(prevCenterRef.current.x - updated.center.x) >= 3 ||
            Math.abs(prevCenterRef.current.y - updated.center.y) >= 3) {
          onViewportChange(updated);
          prevCenterRef.current = updated.center;
        }
      }
      
      return updated;
    });
  }, [onViewportChange, isPanning]);

  // Set center position directly
  const setCenterPosition = useCallback((x: number, y: number) => {
    // Only update if position actually changed
    if (x !== viewport.center.x || y !== viewport.center.y) {
      updateViewport({ center: { x, y } });
      prevCenterRef.current = { x, y };
    }
  }, [updateViewport, viewport.center.x, viewport.center.y]);

  // Change zoom level
  const setZoom = useCallback((zoom: number) => {
    zoom = Math.max(0.5, Math.min(zoom, 3)); // Limit zoom range
    if (zoom !== viewport.zoom) {
      updateViewport({ zoom });
    }
  }, [updateViewport, viewport.zoom]);

  // Convert world coordinates to viewport-relative coordinates
  const worldToViewportCoordinates = useCallback((worldX: number, worldY: number) => {
    const { center, width, height } = viewport;
    
    // Calculate viewport bounds
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);
    
    const minX = center.x - halfWidth;
    const maxX = center.x + halfWidth;
    const minY = center.y - halfHeight;
    const maxY = center.y + halfHeight;
    
    // Check if the world coordinates are within the viewport bounds
    if (worldX < minX || worldX > maxX || worldY < minY || worldY > maxY) {
      return null; // Outside viewport
    }
    
    // Convert to viewport-relative coordinates
    return {
      x: worldX - minX,
      y: worldY - minY
    };
  }, [viewport]);

  // Convert viewport-relative coordinates to world coordinates
  const viewportToWorldCoordinates = useCallback((viewportX: number, viewportY: number) => {
    const { center, width, height } = viewport;
    
    const halfWidth = Math.floor(width / 2);
    const halfHeight = Math.floor(height / 2);
    
    const worldX = center.x - halfWidth + viewportX;
    const worldY = center.y - halfHeight + viewportY;
    
    return { x: worldX, y: worldY };
  }, [viewport]);

  // Start panning
  const handlePanStart = useCallback((clientX: number, clientY: number) => {
    setIsPanning(true);
    setPanStart({
      x: clientX,
      y: clientY,
      centerX: viewport.center.x,
      centerY: viewport.center.y
    });
  }, [viewport.center]);

  // Pan movement - Optimize to reduce the number of state updates
  const handlePanMove = useCallback((clientX: number, clientY: number) => {
    if (isPanning && panStart) {
      // Calculate the distance moved in pixels
      const deltaX = panStart.x - clientX;
      const deltaY = panStart.y - clientY;
      
      // Convert pixel movement to cell movement based on cell size
      const cellDeltaX = Math.round(deltaX / CELL_SIZE);
      const cellDeltaY = Math.round(deltaY / CELL_SIZE);
      
      // Check if we've moved at least 1 cell before updating
      if (cellDeltaX !== 0 || cellDeltaY !== 0) {
        // Update the center position
        updateViewport({
          center: {
            x: panStart.centerX + cellDeltaX,
            y: panStart.centerY + cellDeltaY
          }
        });
      }
    }
  }, [isPanning, panStart, updateViewport, CELL_SIZE]);

  // End panning - Make sure to finalize any pending viewport update
  const handlePanEnd = useCallback(() => {
    if (isPanning && panStart) {
      // Ensure we call onViewportChange one last time with the final position
      if (onViewportChange && 
          (prevCenterRef.current.x !== viewport.center.x || 
           prevCenterRef.current.y !== viewport.center.y)) {
        onViewportChange(viewport);
        prevCenterRef.current = viewport.center;
      }
    }
    
    setIsPanning(false);
    setPanStart(null);
  }, [isPanning, panStart, viewport, onViewportChange]);

  // Handle keyboard panning (WASD or arrow keys)
  const handleKeyboardPan = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    setViewport(prev => {
      const newCenter = { ...prev.center };
      
      switch (direction) {
        case 'up':
          newCenter.y -= KEYBOARD_PAN_AMOUNT;
          break;
        case 'down':
          newCenter.y += KEYBOARD_PAN_AMOUNT;
          break;
        case 'left':
          newCenter.x -= KEYBOARD_PAN_AMOUNT;
          break;
        case 'right':
          newCenter.x += KEYBOARD_PAN_AMOUNT;
          break;
      }
      
      // Update our ref for comparison
      prevCenterRef.current = newCenter;
      
      const updated = { ...prev, center: newCenter };
      if (onViewportChange) {
        onViewportChange(updated);
      }
      return updated;
    });
  }, [onViewportChange, KEYBOARD_PAN_AMOUNT]);

  // Set up global keyboard listeners for WASD/arrow key panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keyboard navigation if we're not in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          handleKeyboardPan('up');
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          handleKeyboardPan('down');
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          handleKeyboardPan('left');
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          handleKeyboardPan('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyboardPan]);

  return {
    viewport,
    isPanning,
    worldToViewportCoordinates,
    viewportToWorldCoordinates,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    handleKeyboardPan,
    setCenterPosition,
    setZoom
  };
}