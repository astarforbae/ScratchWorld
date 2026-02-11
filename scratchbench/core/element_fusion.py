"""
Element fusion utilities for combining DOM and OCR elements
"""
import logging
from typing import List, Dict, Any, Tuple, Optional
import re

logger = logging.getLogger("scratch_bench.element_fusion")
class ElementFusion:
    """
    Handles fusion of DOM and OCR elements with fine-grained control over OCR hiding
    
    Args:
        enable_ocr: Whether to use OCR elements at all
        ocr_min_confidence: Minimum confidence threshold for OCR elements
        hide_covered_ocr_on_canvas: Whether to hide OCR elements covered by DOM elements 
            that contain "on canvas" in their text. DOM elements without "on canvas" 
            will always hide covered OCR elements regardless of this setting.
    """
    
    def __init__(self, 
                 enable_ocr: bool = True,
                 ocr_min_confidence: float = 0.5,
                 hide_covered_ocr_on_canvas: bool = False):
        self.enable_ocr = enable_ocr
        self.ocr_min_confidence = ocr_min_confidence
        self.hide_covered_ocr_on_canvas = hide_covered_ocr_on_canvas
    
    def fuse_elements(self, dom_elements: List[Dict[str, Any]], ocr_elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Fuse DOM and OCR elements, maintaining DOM element order and structure
        
        Args:
            dom_elements: List of DOM elements from batch API
            ocr_elements: List of OCR elements from OCR server
            
        Returns:
            List of unified elements maintaining DOM order. OCR element hiding behavior:
            - DOM elements WITHOUT "on canvas" in text: always hide covered OCR elements
            - DOM elements WITH "on canvas" in text: hide covered OCR elements only if 
              hide_covered_ocr_on_canvas is True
        """
        if not self.enable_ocr or not ocr_elements:
            return self._normalize_dom_elements(dom_elements)
        
        # Normalize elements to common structure
        normalized_dom = self._normalize_dom_elements(dom_elements)
        normalized_ocr = self._normalize_ocr_elements(ocr_elements)
        
        # Find OCR elements covered by DOM elements with fine-grained control
        covered_ocr_indices = set()
        
        for dom_element in normalized_dom:
            if dom_element.get("type", "") == "canvas":
                continue
            has_on_canvas = dom_element.get('block_name', '').find('on canvas') != -1
            
            # Determine whether to hide covered OCR elements for this DOM element
            should_hide_covered = True  # Default: always hide for non-"on canvas" elements
            if has_on_canvas:
                # For "on canvas" elements, use the switch
                should_hide_covered = self.hide_covered_ocr_on_canvas
            
            if should_hide_covered:
                # Find all OCR elements covered by this DOM element
                covered_ocr = self._find_covered_ocr_elements(dom_element, normalized_ocr, covered_ocr_indices)
                
                # Mark these OCR elements as covered (to be removed)
                for ocr_idx in covered_ocr:
                    covered_ocr_indices.add(ocr_idx)
                
                if covered_ocr:
                    ocr_texts = [normalized_ocr[i]['text'] for i in covered_ocr]
                    canvas_status = "on canvas" if has_on_canvas else "regular"
                    logger.debug(f"DOM element {dom_element.get('type', 'unknown')} ({canvas_status}) covers {len(covered_ocr)} OCR elements: {ocr_texts}")
        
        # Add uncovered OCR elements as text-only elements
        uncovered_ocr = [
            self._ocr_to_text_element(normalized_ocr[i]) 
            for i in range(len(normalized_ocr)) 
            if i not in covered_ocr_indices
        ]
        
        # Combine: DOM elements first (unchanged), then uncovered OCR elements
        result = normalized_dom + uncovered_ocr
        
        # Log fusion statistics
        self._log_fusion_stats(len(normalized_dom), len(normalized_ocr), 
                             len(covered_ocr_indices), len(uncovered_ocr))
        
        return result
    
    def _normalize_dom_elements(self, dom_elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize DOM elements to unified structure"""
        normalized = []
        for element in dom_elements:
            normalized.append({
                'id': element.get('id', ''),
                'source': 'dom',
                'bbox': {
                    'x': element.get("position").get('x', 0),
                    'y': element.get("position").get('y', 0),
                    'width': element.get("position").get('width', 0),
                    'height': element.get("position").get('height', 0)
                },
                'text': element.get('text', '').strip(),
                'type': element.get('type', 'unknown'),
                'interactable': self._is_interactable_type(element.get('type', '')),
                'confidences': {
                    'dom_conf': 1.0,
                    'ocr_conf': 0.0,
                    'merged_conf': 1.0
                },
                'dom_metadata': {
                    'selector': element.get('selector', ''),
                    'tag_name': element.get('tag_name', ''),
                    'attributes': element.get('attributes', {}),
                    'visible': element.get('visible', True)
                },
                'ocr_metadata': None,
                # Preserve all original DOM fields
                **{k: v for k, v in element.items() if k not in ['x', 'y', 'width', 'height']}
            })
        return normalized
    
    def _normalize_ocr_elements(self, ocr_elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize OCR elements to unified structure"""
        normalized = []
        for element in ocr_elements:
            if element.get('confidence', 0) >= self.ocr_min_confidence:
                normalized.append({
                    'id': f"ocr_{len(normalized)}",
                    'source': 'ocr',
                    'bbox': {
                        'x': element.get('x', 0),
                        'y': element.get('y', 0),
                        'width': element.get('width', 0),
                        'height': element.get('height', 0)
                    },
                    'text': element.get('text', '').strip(),
                    'type': element.get('element_type', 'text'),
                    'interactable': False,  # OCR elements are not directly interactable
                    'confidences': {
                        'dom_conf': 0.0,
                        'ocr_conf': element.get('confidence', 0.0),
                        'merged_conf': element.get('confidence', 0.0)
                    },
                    'dom_metadata': None,
                    'ocr_metadata': {
                        'raw_text': element.get('text', ''),
                        'confidence': element.get('confidence', 0.0)
                    }
                })
        return normalized
    
    def _ocr_to_text_element(self, ocr_element: Dict[str, Any]) -> Dict[str, Any]:
        """Convert OCR element to text-only element"""
        element = ocr_element.copy()
        element['type'] = 'text'  # Override type for unmatched OCR
        element['interactable'] = False
        return element
    
    def _find_covered_ocr_elements(self, dom_element: Dict[str, Any], ocr_elements: List[Dict[str, Any]], 
                                 already_covered: set) -> List[int]:
        """Find OCR elements that are covered by the DOM element's bounding box"""
        covered_indices = []
        dom_bbox = dom_element['bbox']
        
        for i, ocr_element in enumerate(ocr_elements):
            # Skip if already covered by another DOM element
            if i in already_covered:
                continue
                
            ocr_bbox = ocr_element['bbox']
            
            # Check if OCR element is completely covered by DOM element
            if self._bbox_covers(dom_bbox, ocr_bbox):
                covered_indices.append(i)
        
        return covered_indices
    
    def _bbox_covers(self, outer_bbox: Dict[str, int], inner_bbox: Dict[str, int]) -> bool:
        """Check if outer_bbox completely covers inner_bbox"""
        return (outer_bbox['x'] <= inner_bbox['x'] and
                outer_bbox['y'] <= inner_bbox['y'] and
                outer_bbox['x'] + outer_bbox['width'] >= inner_bbox['x'] + inner_bbox['width'] and
                outer_bbox['y'] + outer_bbox['height'] >= inner_bbox['y'] + inner_bbox['height'])
    
    
    def _is_interactable_type(self, element_type: str) -> bool:
        """Check if element type is interactable"""
        interactable_types = {
            'clickable', 'green_flag', 'stop_button', 'inputs', 
            'sprites', 'blocks', 'flyout_buttons', 'category_menu_item'
        }
        return element_type in interactable_types
    
    def _log_fusion_stats(self, dom_count: int, ocr_count: int, matched_count: int, unmatched_ocr_count: int):
        """Log fusion statistics"""
        total_result = dom_count + unmatched_ocr_count
        logger.info(f"Element fusion: {dom_count} DOM + {ocr_count} OCR → {total_result} total "
                   f"({matched_count} merged, {unmatched_ocr_count} OCR-only)")
