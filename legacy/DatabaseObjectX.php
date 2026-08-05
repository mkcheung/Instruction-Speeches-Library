<?php
require_once("constants.php");
require_once("database.php");

class DatabaseObject{
	protected static $tablename;
	protected static $attributes = array();

    public function get_inserted_id(){
        return mysql_insert_id();
    }

	public function getDbAttributes(){
		$db_attributes = new array();
		foreach(static::$attributes as $attribute){
			if(property_exists($this, $attribute)){
				$db_attributes[$attribute] = $this->$attribute;
			}
		}
		return $db_attributes;
	}

	public function getSanitizedAttributes(){
		$sanitized_attributes = new array();

		$object_attributes = $this->getDbAttributes();

		foreach($object_attributes as $object_attribute => $value){
			$sanitized_attributes[$object_attribute] = mysql_real_escape_string($value);
		}

		return $sanitized_attributes;
	}

	public function create(){
		global $db;

		$sanitizedAttributes = $this->getSanitizedAttributes();

		$sql = "INSERT INTO " . static::$tablename . "(" . join(",", array_keys($sanitized_attributes)) . ") VALUES ('" . join("', '", array_values($sanitized_attributes)) . "')";
	
		if($db->query($sql)){
			$this->id = $this->get_inserted_id();
			return true;
		} else{
			return false;
		}
	}

	public function update(){
		global $db;

		$pairedAttributes = array();
		$sanitizedAttributes = $this->getSanitizedAttributes();

		foreach($sanitizedAttributes as $sanitizedAttribute => $value){
			$pairedAttributes[] = "$sanitizedAttribute = '$value'";
		}

		$sql = "UPDATE " . static::$tablename . " SET " . join(", ", $pairedAttributes) . " " . "WHERE id = '$this->id'" ;
	}

	public function save(){
		if(isset($this->id) && !empty($this->id)){
			$result = 
		}
	}
}

?>