"""
JavaScript file loader for Scratch API operations.
"""
import os
from pathlib import Path
from typing import Dict, Optional

class JSLoader:
    def __init__(self):
        self.api_dir = Path(__file__).parent
        self.api_utils_dir = self.api_dir / "api_utils"
        self.api_scripts_dir = self.api_dir / "api_scripts"
        self.evaluation_scripts_dir = self.api_dir / "evaluation_scripts"
        self._cache: Dict[str, str] = {}
        
    def _load_file(self, file_path: Path) -> str:
        """Load a JavaScript file and cache it."""
        cache_key = str(file_path)
        if cache_key not in self._cache:
            if not file_path.exists():
                raise FileNotFoundError(f"JavaScript file not found: {file_path}")
            with open(file_path, 'r', encoding='utf-8') as f:
                self._cache[cache_key] = f.read()
        return self._cache[cache_key]
    
    def load_utils(self) -> str:
        """Load all utility JavaScript files and combine them."""
        utils = []
        
        # Load common utilities first
        common_path = self.api_utils_dir / "common.js"
        utils.append(self._load_file(common_path))
        
        # Load block utilities
        block_utils_path = self.api_utils_dir / "block_utils.js"
        utils.append(self._load_file(block_utils_path))
        
        # Load connection utilities
        connection_utils_path = self.api_utils_dir / "connection_utils.js"
        utils.append(self._load_file(connection_utils_path))
        
        return "\n\n".join(utils)
    
    def load_script(self, script_name: str) -> str:
        """Load a specific API script."""
        script_path = self.api_scripts_dir / f"{script_name}.js"
        return self._load_file(script_path)
    
    def load_evaluation_script(self, script_name: str) -> str:
        """Load a specific evaluation script."""
        script_path = self.evaluation_scripts_dir / f"{script_name}.js"
        return self._load_file(script_path)
    
    def build_complete_script(self, script_name: str, *args) -> str:
        """Build a complete JavaScript script with utilities and the specific API call."""
        utils = self.load_utils()
        script = self.load_script(script_name)
        
        # If the script is a function that takes parameters, wrap it with the parameters
        if args:
            # Convert Python args to JavaScript format
            js_args = []
            for arg in args:
                if isinstance(arg, str):
                    js_args.append(f"'{arg}'")
                elif isinstance(arg, dict):
                    # Simple dict to JSON conversion
                    import json
                    js_args.append(json.dumps(arg))
                else:
                    js_args.append(str(arg))
            
            complete_script = f"""
{utils}

// Execute the API function
({script})({', '.join(js_args)})
"""
        else:
            complete_script = f"""
{utils}

// Execute the API function
{script}
"""
        
        return complete_script
    
    def build_evaluation_script(self, script_name: str, *args) -> str:
        """Build a complete JavaScript evaluation script with utilities."""
        utils = self.load_utils()
        script = self.load_evaluation_script(script_name)
        
        # If the script is a function that takes parameters, wrap it with the parameters
        if args:
            # Convert Python args to JavaScript format
            js_args = []
            for arg in args:
                if isinstance(arg, str):
                    js_args.append(f"'{arg}'")
                elif isinstance(arg, dict):
                    # Simple dict to JSON conversion
                    import json
                    js_args.append(json.dumps(arg))
                else:
                    js_args.append(str(arg))
            
            complete_script = f"""
{utils}

// Execute the evaluation function
({script})({', '.join(js_args)})
"""
        else:
            complete_script = f"""
{utils}

// Execute the evaluation function
{script}
"""
        
        return complete_script
    
    def clear_cache(self):
        """Clear the file cache (useful for development)."""
        self._cache.clear()

# Global instance
js_loader = JSLoader()
