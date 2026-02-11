/**
 * 评估函数加载器
 * 自动加载evaluation_functions目录下的所有评估函数
 */

const fs = require('fs');
const path = require('path');

/**
 * 动态加载所有评估函数
 * @returns {Object} 包含所有评估函数的对象
 */
function loadEvaluationFunctions() {
  const testFunctions = {};
  const functionsDir = __dirname;
  
  // 读取当前目录下的所有.js文件（除了index.js本身）
  const files = fs.readdirSync(functionsDir)
    .filter(file => file.endsWith('.js') && file !== 'index.js');
  
  console.log(`[函数加载器] 发现 ${files.length} 个评估函数文件:`);
  
  files.forEach(file => {
    const functionName = path.basename(file, '.js');
    const functionPath = path.join(functionsDir, file);
    
    try {
      testFunctions[functionName] = require(functionPath);
      console.log(`[函数加载器] ✅ 加载函数: ${functionName}`);
    } catch (error) {
      console.error(`[函数加载器] ❌ 加载函数失败: ${functionName} - ${error.message}`);
    }
  });
  
  console.log(`[函数加载器] 总共加载了 ${Object.keys(testFunctions).length} 个评估函数`);
  return testFunctions;
}

module.exports = loadEvaluationFunctions;
