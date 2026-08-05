<?php
require_once("constants.php");
require_once("database.php");
require_once("DatabaseObject.php");

class DatabaseObject{

    protected static $tablename;
    protected static $attributes = array();

    public static function find_by_id($id=null){
        global $db;


        $sql = "SELECT * FROM " . static::$tablename . " WHERE id = '" . $id . "' LIMIT 1";
        $resultSet = $db->query($sql);

        while($row = mysql_fetch_assoc($resultSet)){
            $object = static::instantiate($row);
        }

        return $object;
    }

    public static function delete_by_id($id=null){
        global $db;

        $sql = "DELETE FROM " . static::$tablename . " WHERE id = '" . $id . "'";
        $result = $db->query($sql);
        if($result == null){
            die("Could not delete from " . static::$tablename ."." . mysql_error()) ;
        }
    }

    public static function find_all(){
        global $db;
        $sql = "SELECT * FROM " . static::$tablename ;
        $result = $db->query($sql);
        while($row = mysql_fetch_assoc($result)){
            $object_array[] = static::instantiate($row);
        }
        return $object_array;
        //return mysql_fetch_array($result, MYSQL_ASSOC);
    }



    public function get_inserted_id(){
        return mysql_insert_id();
    }

    private static function sanitize_value($attr){
        return mysql_real_escape_string($attr);
    }

    protected function validate_attributes($aKey){
        if(in_array($aKey, static::$attributes) && property_exists($this, $aKey)){
            return true;
        } else {
            die("Invalid attributes for object instantiation. " . mysql_error());
        }
    }

    protected static function instantiate($row){//($id){
        global $db;
        $object = new static;

        foreach($row as $attribute => $value){
            if($object->has_attribute($attribute)){
                $object->$attribute = $value;
            }
        }

        return $object;
    }

    public function has_attribute($attribute){
        $allAttributes = get_object_vars($this);
        return array_key_exists($attribute, $allAttributes);
    }

    public function getDbAttributes(){
        $db_attributes = array();

        foreach(static::$attributes as $attribute){

            if(property_exists($this, $attribute)){
                $db_attributes[$attribute] = $this->$attribute;
            }
        }
        return($db_attributes);
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
    
        $sql = "INSERT INTO " . static::$tablename . "(" . join(", ", array_keys($databaseAttributes)) . ") VALUES ('" . join("', '", array_values($databaseAttributes)) . "')";

        // echo $sql;

        if($db->query($sql)){
            $this->id = $this->get_inserted_id();
            return true;
        } else {
            return false; 
        }
    }

    public function update(){
        global $db;

        $pairedAttributes = array();

        $databaseAttributes = $this->getSanitizedAttributes();
        
        foreach ($databaseAttributes as $databaseAttribute => $value){
            $pairedAttributes[] = "$databaseAttribute = '$value'";
        }

        $sql = "UPDATE " . static::$tablename .
               " SET " . join(", ", $pairedAttributes) . " " . "WHERE id = '$this->id'"  ;


        if($db->query($sql)){
            return true;
        } else {
            return false;
        }
    }

    public function save(){
        if(isset($this->id) && !empty($this->id)){
            $result = $this->update();
            return $result;
        } else {
            $result = $this->create();
            return $result;
        }
    }

}


?>