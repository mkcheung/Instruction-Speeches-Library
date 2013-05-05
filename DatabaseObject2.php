<?php
require_once("constants.php");
require_once("database.php");

class DatabaseObject {

	protected static $tablename;
	protected static $attributes = array();

	public function getDbAttributes(){
		$db_attributes = array();
		foreach($attributes as $attribute => $value){
			if(property_exists($this, $attribute)){
				$db_attributes[$attribute] = $value;
			}
		}
		return $db_attributes;
	}

	public function getSanitizedAttributes(){
		$sanitized_attributes = array();

		$object_attributes = $this->getDbAttributes();
		foreach($object_attributes as $object_attribute => $value){
			$sanitized_attributes[$object_attribute] = mysql_real_escape_string($value);
		}
		return $sanitized_attributes;
	}

	public function create(){
		global $db;

		$databaseAttributes = $this->getSanitizedAttributes();

		$sql = "INSERT INTO " . static::$tablename . "(" . join(', ', array_keys($databaseAttributes)) . ") VALUES ('" . join("', '", array_values($databaseAttributes)) ."')";

		if($db->query($sql)){
			$this->$id = mysql_insert_id();
			return true;
		} else {
			return false;
		}
	}

	public function update(){
		global $db;

		$pairedAttributes = array();
		$databaseAttributes = $this->getSanitizedAttributes();

		foreach($databaseAttributes as $databaseAttribute => $value){
			$pairedAttributes[] = "$databaseAttributes = '$value'";
		}

		$sql = "UPDATE " . static::$tablename .
			   " SET " , join(", ", $pairedAttributes) . " WHERE id = '$this->$id'" ;

		if($db->query($sql)){
			return true;
		} else {
			return false;
		}
	}

	public function save(){
		if(isset($this->$id) && !empty($this->$id)){
			$result = $this->update();
		} else {
			$result = $this->insert();
		}
		return $result;
	}

	public function has_attribute($attribute){
		$allAttributes = get_object_vars($this);
		return array_key_exists($attribute, $allAttributes);
	}

	public static function instantiate($row){
		$object = new static;

		foreach($row as $attribute => $value){
			if($object->has_attribute($attribute))
				$object->$attribute = $valuel
		}

		return $object;
	}

}

?>